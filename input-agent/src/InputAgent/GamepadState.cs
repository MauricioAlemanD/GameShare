namespace InputAgent;

/// <summary>Estado completo de un mando con la disposición XInput (XUSB).</summary>
public readonly record struct GamepadState(
    ushort Buttons,
    byte LeftTrigger,
    byte RightTrigger,
    short LeftX,
    short LeftY,
    short RightX,
    short RightY)
{
    public static readonly GamepadState Neutral = new(0, 0, 0, 0, 0, 0, 0);

    // Bits XUSB.
    public const ushort DpadUp = 0x0001, DpadDown = 0x0002, DpadLeft = 0x0004, DpadRight = 0x0008;
    public const ushort Start = 0x0010, Back = 0x0020, LeftThumb = 0x0040, RightThumb = 0x0080;
    public const ushort LeftShoulder = 0x0100, RightShoulder = 0x0200, Guide = 0x0400;
    public const ushort A = 0x1000, B = 0x2000, X = 0x4000, Y = 0x8000;

    /// <summary>
    /// Botones que puede pulsar un jugador remoto. Se excluye Guide (abre la Xbox Game Bar/Steam del anfitrión)
    /// y el bit 0x0800, que no está definido.
    /// </summary>
    public const ushort AllowedButtons = 0xFFFF & ~(Guide | 0x0800);

    public bool IsNeutral => this == Neutral;
}
