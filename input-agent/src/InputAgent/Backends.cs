using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace InputAgent;

/// <summary>Un mando virtual. La implementación decide el driver (ViGEm hoy; otro en el futuro).</summary>
public interface IVirtualPad : IDisposable
{
    void Connect();
    void Apply(GamepadState state);
    /// <summary>Índice XInput asignado por Windows (0-3), o -1 si no se conoce.</summary>
    int UserIndex { get; }
    /// <summary>Vibración pedida por el juego: (motor grande, motor pequeño), 0-255.</summary>
    event Action<byte, byte>? Rumble;
}

/// <summary>Crea mandos virtuales. Cambiar de driver = otra implementación de esta interfaz.</summary>
public interface IGamepadBackend : IDisposable
{
    string Name { get; }
    IVirtualPad CreatePad();
}

/// <summary>Mando Xbox 360 virtual mediante el driver ViGEmBus.</summary>
public sealed class ViGEmBackend : IGamepadBackend
{
    private readonly ViGEmClient _client;
    private bool _disposed;

    /// <exception cref="Nefarius.ViGEm.Client.Exceptions.VigemBusNotFoundException">Si el driver no está instalado.</exception>
    public ViGEmBackend() => _client = new ViGEmClient();

    public string Name => "ViGEmBus (Xbox 360)";

    public IVirtualPad CreatePad()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return new Pad(_client.CreateXbox360Controller());
    }

    /// <summary>Idempotente: liberar dos veces el cliente nativo de ViGEm tumba el proceso.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _client.Dispose();
    }

    private sealed class Pad : IVirtualPad
    {
        private readonly IXbox360Controller _pad;
        private bool _connected;

        public Pad(IXbox360Controller pad)
        {
            _pad = pad;
            _pad.AutoSubmitReport = false;
            _pad.FeedbackReceived += OnFeedback;
        }

        public event Action<byte, byte>? Rumble;

        public int UserIndex
        {
            get
            {
                try { return _pad.UserIndex; }
                catch { return -1; }
            }
        }

        public void Connect()
        {
            _pad.Connect();
            _connected = true;
        }

        public void Apply(GamepadState s)
        {
            _pad.SetButtonsFull(s.Buttons);
            _pad.SetSliderValue(Xbox360Slider.LeftTrigger, s.LeftTrigger);
            _pad.SetSliderValue(Xbox360Slider.RightTrigger, s.RightTrigger);
            _pad.SetAxisValue(Xbox360Axis.LeftThumbX, s.LeftX);
            _pad.SetAxisValue(Xbox360Axis.LeftThumbY, s.LeftY);
            _pad.SetAxisValue(Xbox360Axis.RightThumbX, s.RightX);
            _pad.SetAxisValue(Xbox360Axis.RightThumbY, s.RightY);
            _pad.SubmitReport();
        }

        private void OnFeedback(object sender, Xbox360FeedbackReceivedEventArgs e) => Rumble?.Invoke(e.LargeMotor, e.SmallMotor);

        public void Dispose()
        {
            _pad.FeedbackReceived -= OnFeedback;
            if (_connected)
            {
                try
                {
                    Apply(GamepadState.Neutral);
                    _pad.Disconnect();
                }
                catch
                {
                    // El driver puede haberse ido ya; no hay nada más que liberar.
                }
                _connected = false;
            }
        }
    }
}

/// <summary>Backend en memoria para pruebas y para ejecutar sin driver (--backend=fake).</summary>
public sealed class FakeBackend : IGamepadBackend
{
    public List<FakePad> Pads { get; } = new();
    public string Name => "fake";

    public IVirtualPad CreatePad()
    {
        var pad = new FakePad(Pads.Count);
        Pads.Add(pad);
        return pad;
    }

    public void Dispose() { }

    public sealed class FakePad(int index) : IVirtualPad
    {
        public bool Connected { get; private set; }
        public bool Disposed { get; private set; }
        public List<GamepadState> Applied { get; } = new();
        public GamepadState Last => Applied.Count > 0 ? Applied[^1] : GamepadState.Neutral;
        public int UserIndex => index;
        public event Action<byte, byte>? Rumble;

        public void Connect() => Connected = true;
        public void Apply(GamepadState state) => Applied.Add(state);
        public void FireRumble(byte large, byte small) => Rumble?.Invoke(large, small);

        public void Dispose()
        {
            if (Connected) Applied.Add(GamepadState.Neutral);
            Connected = false;
            Disposed = true;
        }
    }
}
