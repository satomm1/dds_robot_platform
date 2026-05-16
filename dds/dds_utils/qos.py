from cyclonedds.util import duration
from cyclonedds.core import Qos, Policy

reliable_qos = Qos(
    Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
    Policy.Durability.TransientLocal,
    Policy.History.KeepLast(depth=1),
)

# Same as reliable_qos but samples expire quickly so they are not replayed to
# DataReaders that match later (e.g. robot process restart). Transient local
# alone would keep the last stop/shutdown for late joiners.
reliable_transient_local_command_qos = Qos(
    Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
    Policy.Durability.TransientLocal,
    Policy.History.KeepLast(depth=1),
    Policy.Lifespan(duration(seconds=5)),
)

best_effort_qos = Qos(
    Policy.Reliability.BestEffort,
    Policy.Durability.Volatile,
    Policy.Liveliness.ManualByParticipant(lease_duration=duration(milliseconds=30000)),
)
