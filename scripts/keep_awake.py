"""Keep Windows from idle-sleeping while another process runs.

    python scripts/keep_awake.py <pid>

Asks Windows not to sleep (the same request a video player makes) until the
process exits. Changes no settings; closing the lid still sleeps.
"""
import ctypes
import sys
import time

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
SYNCHRONIZE = 0x00100000
WAIT_TIMEOUT = 0x102


def main() -> None:
    pid = int(sys.argv[1])
    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        print(f"process {pid} not found")
        return
    k32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    try:
        while k32.WaitForSingleObject(handle, 60_000) == WAIT_TIMEOUT:
            k32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    finally:
        k32.SetThreadExecutionState(ES_CONTINUOUS)
        k32.CloseHandle(handle)
    print(f"process {pid} finished at {time.strftime('%H:%M')}")


if __name__ == "__main__":
    main()
