using InputAgent;

namespace InputAgent.Tests;

public class AgentTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
        public void Advance(TimeSpan d) => Now += d;
    }

    private readonly FakeBackend _backend = new();
    private readonly List<string> _out = new();
    private readonly ManualTime _time = new();
    private readonly Agent _agent;

    public AgentTests() => _agent = new Agent(_backend, _out.Add, _time);

    [Fact]
    public void ConnectApplyAndDisconnect()
    {
        _agent.Handle("C 0");
        Assert.Contains("CONNECTED 0 0", _out);
        var pad = _backend.Pads.Single();
        Assert.True(pad.Connected);

        _agent.Handle($"S 0 {GamepadState.A} 0 255 100 -100 0 0");
        Assert.Equal(new GamepadState(GamepadState.A, 0, 255, 100, -100, 0, 0), pad.Last);

        _agent.Handle("D 0");
        Assert.True(pad.Disposed);
        Assert.True(pad.Last.IsNeutral); // al desconectar se suelta todo
        Assert.Contains("DISCONNECTED 0", _out);
    }

    [Fact]
    public void ConnectingTwiceReusesThePad()
    {
        _agent.Handle("C 0");
        _agent.Handle("C 0");
        Assert.Single(_backend.Pads);
    }

    [Fact]
    public void StatesForUnconnectedSlotsAreIgnored()
    {
        _agent.Handle($"S 1 {GamepadState.A} 0 0 0 0 0 0");
        Assert.Empty(_backend.Pads);
    }

    [Fact]
    public void WatchdogReleasesButtonsWhenStatesStop()
    {
        _agent.Handle("C 0");
        _agent.Handle($"S 0 {GamepadState.A | GamepadState.B} 255 255 32767 0 0 0");
        var pad = _backend.Pads.Single();

        _time.Advance(TimeSpan.FromMilliseconds(400));
        _agent.Tick();
        Assert.False(pad.Last.IsNeutral); // aún dentro del margen

        _time.Advance(TimeSpan.FromMilliseconds(200));
        _agent.Tick();
        Assert.True(pad.Last.IsNeutral);
        Assert.Contains("NEUTRAL 0 watchdog", _out);
        Assert.True(pad.Connected); // el mando sigue conectado, solo se suelta
    }

    [Fact]
    public void WatchdogDoesNotSpamWhenAlreadyNeutral()
    {
        _agent.Handle("C 0");
        _time.Advance(TimeSpan.FromSeconds(5));
        _agent.Tick();
        _agent.Tick();
        Assert.DoesNotContain(_out, l => l.StartsWith("NEUTRAL"));
    }

    [Fact]
    public void RateLimitDropsExcessStates()
    {
        _agent.Handle("C 0");
        var pad = _backend.Pads.Single();
        var before = pad.Applied.Count;
        for (var i = 0; i < Agent.MaxStatesPerSecond + 100; i++)
        {
            _agent.Handle($"S 0 {i % 2} 0 0 0 0 0 0");
        }
        Assert.Equal(Agent.MaxStatesPerSecond, pad.Applied.Count - before);

        _time.Advance(TimeSpan.FromSeconds(1));
        _agent.Handle("S 0 1 0 0 0 0 0 0");
        Assert.Equal(Agent.MaxStatesPerSecond + 1, pad.Applied.Count - before);
    }

    [Fact]
    public void RumbleIsForwarded()
    {
        _agent.Handle("C 2");
        var pad = _backend.Pads.Single();
        pad.FireRumble(0, 0);       // valor inicial del driver: no se informa
        pad.FireRumble(200, 50);
        pad.FireRumble(200, 50);    // repetido: no se informa
        pad.FireRumble(0, 0);
        Assert.Equal(new[] { "RUMBLE 2 200 50", "RUMBLE 2 0 0" }, _out.Where(l => l.StartsWith("RUMBLE")));
    }

    [Fact]
    public void InvalidCommandsReportErrorButKeepRunning()
    {
        Assert.True(_agent.Handle("rm -rf /"));
        Assert.Contains(_out, l => l.StartsWith("ERROR BAD_COMMAND"));
    }

    [Fact]
    public void QuitAndDisposeReleaseEverything()
    {
        _agent.Handle("C 0");
        _agent.Handle("C 1");
        _agent.Handle($"S 1 {GamepadState.Y} 0 0 0 0 0 0");
        Assert.False(_agent.Handle("Q"));
        _agent.Dispose();
        Assert.All(_backend.Pads, p => Assert.True(p.Disposed));
        Assert.All(_backend.Pads, p => Assert.True(p.Last.IsNeutral));
    }
}
