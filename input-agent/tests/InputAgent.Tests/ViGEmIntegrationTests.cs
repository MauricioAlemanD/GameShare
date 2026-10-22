using System.Diagnostics;
using System.Text.Json;
using InputAgent;
using Xunit.Abstractions;

namespace InputAgent.Tests;

/// <summary>
/// Pruebas con el driver REAL: crean un mando Xbox virtual y lo leen por XInput, como haría un juego.
/// Puede haber mandos físicos conectados, así que se busca el estado esperado en los 4 puestos.
/// Si ViGEmBus no está instalado, las pruebas lo indican y no fallan.
/// </summary>
[Collection("ViGEm")]
public class ViGEmIntegrationTests(ITestOutputHelper log)
{
    // Valores improbables en un mando físico en reposo.
    private static readonly GamepadState Probe = new(
        (ushort)(GamepadState.A | GamepadState.DpadUp | GamepadState.RightShoulder), 12, 250, -32768, 32767, 1234, -4321);

    private static ViGEmBackend? TryBackend(ITestOutputHelper log)
    {
        try
        {
            return new ViGEmBackend();
        }
        catch (Exception e)
        {
            log.WriteLine($"ViGEmBus no disponible, prueba omitida: {e.Message}");
            return null;
        }
    }

    [Fact]
    public void VirtualPadIsVisibleToXInputWithExactState()
    {
        using var backend = TryBackend(log);
        if (backend is null) return;
        var before = ConnectedSlots();
        log.WriteLine($"Puestos XInput ocupados antes: [{string.Join(",", before)}]");

        var pad = backend.CreatePad();
        pad.Connect();
        try
        {
            // Se reenvía el estado mientras se espera, como hace el cliente real (≥ 10 estados/s).
            var found = WaitForStateAnywhere(Probe, () => pad.Apply(Probe));
            Assert.NotNull(found);
            Assert.DoesNotContain(found.Value, before); // es un puesto nuevo, no un mando físico
            log.WriteLine($"Mando virtual visible en el puesto XInput {found} (ViGEm informa {pad.UserIndex})");

            pad.Apply(GamepadState.Neutral);
            Thread.Sleep(50);
            Assert.Equal(GamepadState.Neutral, XInput.Read(found.Value));
        }
        finally
        {
            pad.Dispose();
        }
        Assert.Equal(before, WaitForSlots(before));
    }

    [Fact]
    public void AgentProcessCreatesPadAndRemovesItOnStdinClose()
    {
        var exe = Path.Combine(AppContext.BaseDirectory, "InputAgent.exe");
        using (var backend = TryBackend(log))
        {
            if (backend is null) return;
        }
        var before = ConnectedSlots();

        var psi = new ProcessStartInfo(exe)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi)!;
        Assert.StartsWith("READY 1", proc.StandardOutput.ReadLine());

        proc.StandardInput.WriteLine("C 0");
        var connected = proc.StandardOutput.ReadLine()!;
        while (connected.StartsWith("RUMBLE")) connected = proc.StandardOutput.ReadLine()!;
        log.WriteLine(connected);
        Assert.Matches(@"^CONNECTED 0 [0-3]$", connected);

        var line = $"S 0 {Probe.Buttons} {Probe.LeftTrigger} {Probe.RightTrigger} {Probe.LeftX} {Probe.LeftY} {Probe.RightX} {Probe.RightY}";
        var found = WaitForStateAnywhere(Probe, () =>
        {
            proc.StandardInput.WriteLine(line);
            proc.StandardInput.Flush();
        });
        Assert.NotNull(found);

        // El watchdog suelta los botones si dejan de llegar estados.
        Thread.Sleep(800);
        Assert.Equal(GamepadState.Neutral, XInput.Read(found.Value));

        // Cierre abrupto de la entrada (como si Electron se colgase): el mando desaparece.
        proc.StandardInput.Close();
        Assert.True(proc.WaitForExit(5000));
        Assert.Equal(before, WaitForSlots(before));
    }

    [Fact]
    public void ProbeModePrintsFourSlots()
    {
        var exe = Path.Combine(AppContext.BaseDirectory, "InputAgent.exe");
        var psi = new ProcessStartInfo(exe, "probe-xinput") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
        using var proc = Process.Start(psi)!;
        var json = proc.StandardOutput.ReadToEnd();
        proc.WaitForExit();
        Assert.Equal(4, JsonDocument.Parse(json).RootElement.GetArrayLength());
    }

    private static int[] ConnectedSlots() => Enumerable.Range(0, 4).Where(i => XInput.Read(i) is not null).ToArray();

    private static int? WaitForStateAnywhere(GamepadState expected, Action resend)
    {
        for (var i = 0; i < 100; i++)
        {
            resend();
            Thread.Sleep(10);
            for (var slot = 0; slot < 4; slot++)
            {
                if (XInput.Read(slot) == expected) return slot;
            }
        }
        return null;
    }

    private static int[] WaitForSlots(int[] expected)
    {
        var now = ConnectedSlots();
        for (var i = 0; i < 100 && !now.SequenceEqual(expected); i++)
        {
            Thread.Sleep(20);
            now = ConnectedSlots();
        }
        return now;
    }
}
