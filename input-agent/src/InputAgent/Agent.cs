namespace InputAgent;

/// <summary>
/// Lógica del agente: gestiona hasta 4 mandos virtuales, aplica estados, limita la frecuencia y,
/// si deja de recibir estados, suelta todos los botones (watchdog). Thread-safe.
/// </summary>
public sealed class Agent : IDisposable
{
    /// <summary>Sin estados durante este tiempo → se sueltan todos los botones.</summary>
    public static readonly TimeSpan WatchdogTimeout = TimeSpan.FromMilliseconds(500);
    /// <summary>Máximo de estados por segundo y mando (el proceso principal ya limita a 250).</summary>
    public const int MaxStatesPerSecond = 500;

    private sealed class Slot
    {
        public required IVirtualPad Pad;
        public DateTimeOffset LastState;
        public bool IsNeutral = true;
        public DateTimeOffset WindowStart;
        public int WindowCount;
    }

    private readonly IGamepadBackend _backend;
    private readonly Action<string> _emit;
    private readonly TimeProvider _time;
    private readonly Slot?[] _slots = new Slot?[Protocol.MaxSlots];
    private readonly object _lock = new();
    private bool _disposed;

    public Agent(IGamepadBackend backend, Action<string> emit, TimeProvider? time = null)
    {
        _backend = backend;
        _emit = emit;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Procesa una línea. Devuelve false si hay que terminar.</summary>
    public bool Handle(string? line)
    {
        var cmd = Protocol.Parse(line);
        if (cmd is null)
        {
            _emit("ERROR BAD_COMMAND Orden no válida");
            return true;
        }
        lock (_lock)
        {
            if (_disposed) return false;
            switch (cmd)
            {
                case Command.Ping:
                    _emit("PONG");
                    break;
                case Command.Quit:
                    return false;
                case Command.Connect c:
                    ConnectSlot(c.Slot);
                    break;
                case Command.Disconnect d:
                    DisconnectSlot(d.Slot);
                    break;
                case Command.Neutral n:
                    if (_slots[n.Slot] is { } ns) ApplyNeutral(n.Slot, ns, "request");
                    break;
                case Command.State s:
                    ApplyState(s.Slot, s.Value);
                    break;
            }
        }
        return true;
    }

    /// <summary>Se llama periódicamente (~cada 50 ms): suelta los botones de los mandos sin datos recientes.</summary>
    public void Tick()
    {
        lock (_lock)
        {
            var now = _time.GetUtcNow();
            for (var i = 0; i < _slots.Length; i++)
            {
                if (_slots[i] is { IsNeutral: false } slot && now - slot.LastState > WatchdogTimeout)
                {
                    ApplyNeutral(i, slot, "watchdog");
                }
            }
        }
    }

    public bool IsConnected(int slot)
    {
        lock (_lock) return _slots[slot] is not null;
    }

    private void ConnectSlot(int slot)
    {
        if (_slots[slot] is { } existing)
        {
            _emit($"CONNECTED {slot} {existing.Pad.UserIndex}");
            return;
        }
        IVirtualPad pad;
        try
        {
            pad = _backend.CreatePad();
            pad.Connect();
            pad.Apply(GamepadState.Neutral);
        }
        catch (Exception e)
        {
            _emit($"ERROR CONNECT_FAILED {Sanitize(e.Message)}");
            return;
        }
        var s = new Slot { Pad = pad, LastState = _time.GetUtcNow(), WindowStart = _time.GetUtcNow() };
        // Solo se informan los cambios de vibración (el driver repite valores; el primero suele ser 0 0).
        var lastRumble = (Large: (byte)0, Small: (byte)0);
        pad.Rumble += (large, small) =>
        {
            lock (_lock)
            {
                if ((large, small) == lastRumble) return;
                lastRumble = (large, small);
            }
            _emit($"RUMBLE {slot} {large} {small}");
        };
        _slots[slot] = s;
        // Windows asigna el puesto XInput (jugador 1-4) unos milisegundos después de conectar.
        var index = pad.UserIndex;
        for (var i = 0; i < 75 && index < 0; i++)
        {
            Thread.Sleep(20);
            index = pad.UserIndex;
        }
        _emit($"CONNECTED {slot} {index}");
    }

    private void DisconnectSlot(int slot)
    {
        if (_slots[slot] is not { } s) return;
        _slots[slot] = null;
        s.Pad.Dispose(); // suelta todo y desconecta
        _emit($"DISCONNECTED {slot}");
    }

    private void ApplyState(int slot, GamepadState state)
    {
        if (_slots[slot] is not { } s)
        {
            return; // estado para un mando no conectado: se ignora en silencio (puede llegar tras una desconexión)
        }
        var now = _time.GetUtcNow();
        if (now - s.WindowStart >= TimeSpan.FromSeconds(1))
        {
            s.WindowStart = now;
            s.WindowCount = 0;
        }
        if (++s.WindowCount > MaxStatesPerSecond)
        {
            return; // exceso: se descarta
        }
        s.LastState = now;
        s.IsNeutral = state.IsNeutral;
        s.Pad.Apply(state);
    }

    private void ApplyNeutral(int slot, Slot s, string reason)
    {
        s.Pad.Apply(GamepadState.Neutral);
        s.IsNeutral = true;
        _emit($"NEUTRAL {slot} {reason}");
    }

    private static string Sanitize(string message) => message.Replace('\r', ' ').Replace('\n', ' ');

    /// <summary>Desconecta todos los mandos (fin de sesión, cierre de Electron o EOF en stdin).</summary>
    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            for (var i = 0; i < _slots.Length; i++) DisconnectSlot(i);
            _disposed = true;
        }
    }
}
