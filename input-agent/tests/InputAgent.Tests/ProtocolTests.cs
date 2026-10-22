using InputAgent;

namespace InputAgent.Tests;

public class ProtocolTests
{
    [Fact]
    public void ParsesFullState()
    {
        var cmd = Assert.IsType<Command.State>(Protocol.Parse("S 0 4096 10 255 -32768 32767 0 -1"));
        Assert.Equal(0, cmd.Slot);
        Assert.Equal(new GamepadState(GamepadState.A, 10, 255, -32768, 32767, 0, -1), cmd.Value);
    }

    [Fact]
    public void GuideButtonIsAlwaysStripped()
    {
        var cmd = Assert.IsType<Command.State>(Protocol.Parse($"S 1 {GamepadState.Guide | GamepadState.A | 0x0800} 0 0 0 0 0 0"));
        Assert.Equal(GamepadState.A, cmd.Value.Buttons);
    }

    [Theory]
    [InlineData("C 0", typeof(Command.Connect))]
    [InlineData("D 3", typeof(Command.Disconnect))]
    [InlineData("N 2", typeof(Command.Neutral))]
    [InlineData("P", typeof(Command.Ping))]
    [InlineData("Q", typeof(Command.Quit))]
    public void ParsesSimpleCommands(string line, Type type) => Assert.IsType(type, Protocol.Parse(line));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("X 0")]
    [InlineData("C 4")]                        // puesto fuera de rango
    [InlineData("C -1")]
    [InlineData("C 0 extra")]
    [InlineData("S 0 1 2 3")]                  // faltan campos
    [InlineData("S 0 70000 0 0 0 0 0 0")]      // botones fuera de rango
    [InlineData("S 0 0 256 0 0 0 0 0")]        // gatillo fuera de rango
    [InlineData("S 0 0 0 0 40000 0 0 0")]      // eje fuera de rango
    [InlineData("S 0 0 0 0 1.5 0 0 0")]        // decimales
    [InlineData("S 0 0x10 0 0 0 0 0 0")]       // hexadecimal
    [InlineData("S 0 +1 0 0 0 0 0 0")]         // signo en un campo sin signo
    public void RejectsInvalidLines(string? line) => Assert.Null(Protocol.Parse(line));

    [Fact]
    public void RejectsOverlongLines() => Assert.Null(Protocol.Parse("P" + new string(' ', 200)));
}
