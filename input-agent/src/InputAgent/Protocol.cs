using System.Globalization;

namespace InputAgent;

/// <summary>
/// Protocolo de texto por stdin/stdout con el proceso principal de Electron (una orden por línea).
///
/// Entrada (Electron → agente):
///   C &lt;slot&gt;                                   conectar un mando virtual
///   S &lt;slot&gt; &lt;btn&gt; &lt;lt&gt; &lt;rt&gt; &lt;lx&gt; &lt;ly&gt; &lt;rx&gt; &lt;ry&gt;   estado completo
///   N &lt;slot&gt;                                   soltar todo (estado neutro)
///   D &lt;slot&gt;                                   desconectar el mando virtual
///   P                                          ping
///   Q                                          salir (desconecta todo)
///
/// Salida (agente → Electron):
///   READY &lt;versión&gt; · PONG · CONNECTED &lt;slot&gt; &lt;userIndex|-1&gt; · DISCONNECTED &lt;slot&gt;
///   NEUTRAL &lt;slot&gt; &lt;motivo&gt; · RUMBLE &lt;slot&gt; &lt;grande&gt; &lt;pequeño&gt; · ERROR &lt;código&gt; &lt;mensaje&gt;
/// </summary>
public abstract record Command
{
    public sealed record Connect(int Slot) : Command;
    public sealed record Disconnect(int Slot) : Command;
    public sealed record Neutral(int Slot) : Command;
    public sealed record State(int Slot, GamepadState Value) : Command;
    public sealed record Ping : Command;
    public sealed record Quit : Command;
}

public static class Protocol
{
    public const int Version = 1;
    public const int MaxSlots = 4;
    public const int MaxLineLength = 128;

    /// <summary>Interpreta una línea. Devuelve null si no es válida; nunca lanza excepciones.</summary>
    public static Command? Parse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line) || line.Length > MaxLineLength)
        {
            return null;
        }
        var p = line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        switch (p[0])
        {
            case "P" when p.Length == 1:
                return new Command.Ping();
            case "Q" when p.Length == 1:
                return new Command.Quit();
            case "C" when p.Length == 2 && TrySlot(p[1], out var c):
                return new Command.Connect(c);
            case "D" when p.Length == 2 && TrySlot(p[1], out var d):
                return new Command.Disconnect(d);
            case "N" when p.Length == 2 && TrySlot(p[1], out var n):
                return new Command.Neutral(n);
            case "S" when p.Length == 9 && TrySlot(p[1], out var s):
                if (ushort.TryParse(p[2], NumberStyles.None, CultureInfo.InvariantCulture, out var buttons)
                    && byte.TryParse(p[3], NumberStyles.None, CultureInfo.InvariantCulture, out var lt)
                    && byte.TryParse(p[4], NumberStyles.None, CultureInfo.InvariantCulture, out var rt)
                    && short.TryParse(p[5], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var lx)
                    && short.TryParse(p[6], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var ly)
                    && short.TryParse(p[7], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var rx)
                    && short.TryParse(p[8], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var ry))
                {
                    // Los botones no permitidos (Guide) se eliminan aquí, en la última barrera.
                    var safe = (ushort)(buttons & GamepadState.AllowedButtons);
                    return new Command.State(s, new GamepadState(safe, lt, rt, lx, ly, rx, ry));
                }
                return null;
            default:
                return null;
        }
    }

    private static bool TrySlot(string text, out int slot) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out slot) && slot is >= 0 and < MaxSlots;
}
