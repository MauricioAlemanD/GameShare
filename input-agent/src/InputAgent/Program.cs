using InputAgent;
using Nefarius.ViGEm.Client.Exceptions;

// GameShare input-agent: crea mandos Xbox virtuales para los jugadores remotos.
// Solo atiende a su proceso padre por stdin/stdout. No abre puertos ni toca el teclado o el ratón.
//
// Uso:
//   InputAgent                    modo normal (ViGEmBus)
//   InputAgent --backend=fake     sin driver (pruebas)
//   InputAgent probe-xinput       imprime el estado XInput de los 4 puestos y sale

if (args.Contains("probe-xinput"))
{
    Console.WriteLine(XInput.ProbeJson());
    return 0;
}

var output = Console.Out;
var outLock = new object();
void Emit(string line)
{
    lock (outLock)
    {
        output.WriteLine(line);
        output.Flush();
    }
}

IGamepadBackend backend;
try
{
    backend = args.Contains("--backend=fake") ? new FakeBackend() : new ViGEmBackend();
}
catch (VigemBusNotFoundException)
{
    Emit("ERROR NO_DRIVER ViGEmBus no está instalado");
    return 2;
}
catch (Exception e)
{
    Emit($"ERROR BACKEND_FAILED {e.Message.Replace('\n', ' ')}");
    return 3;
}

using (backend)
using (var agent = new Agent(backend, Emit))
{
    using var watchdog = new Timer(_ => agent.Tick(), null, 50, 50);
    Emit($"READY {Protocol.Version} {backend.Name}");

    // stdin cerrado (Electron terminó o se colgó) → se desconectan todos los mandos y se sale.
    string? line;
    while ((line = Console.In.ReadLine()) is not null)
    {
        if (!agent.Handle(line)) break;
    }
}
return 0;
