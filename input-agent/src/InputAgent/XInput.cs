using System.Runtime.InteropServices;
using System.Text.Json;

namespace InputAgent;

/// <summary>Lectura de XInput (lo que ven los juegos). Se usa para verificar el mando virtual.</summary>
public static class XInput
{
    [StructLayout(LayoutKind.Sequential)]
    public struct XInputGamepad
    {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XInputState
    {
        public uint dwPacketNumber;
        public XInputGamepad Gamepad;
    }

    [DllImport("xinput1_4.dll")]
    private static extern uint XInputGetState(uint dwUserIndex, out XInputState pState);

    public static GamepadState? Read(int userIndex)
    {
        if (XInputGetState((uint)userIndex, out var s) != 0) return null; // 0 = ERROR_SUCCESS
        var g = s.Gamepad;
        return new GamepadState(g.wButtons, g.bLeftTrigger, g.bRightTrigger, g.sThumbLX, g.sThumbLY, g.sThumbRX, g.sThumbRY);
    }

    /// <summary>JSON con el estado de los 4 puestos XInput (null = sin mando).</summary>
    public static string ProbeJson()
    {
        var slots = Enumerable.Range(0, 4).Select(i => Read(i) is { } s
            ? new { connected = true, buttons = (int)s.Buttons, lt = (int)s.LeftTrigger, rt = (int)s.RightTrigger, lx = (int)s.LeftX, ly = (int)s.LeftY, rx = (int)s.RightX, ry = (int)s.RightY }
            : (object)new { connected = false });
        return JsonSerializer.Serialize(slots);
    }
}
