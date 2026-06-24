import argparse
import ctypes
import json
import time
from ctypes import byref, c_int
from datetime import datetime, timezone


SD_FIND = 1
PASSWORDS = (0x015A, 0x2D58, 0xEA8D, 0x5D21)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")))


def check_dongle(dll_path, retry_count, retry_interval):
    hinst = ctypes.windll.LoadLibrary(dll_path)
    secure_dongle = hinst.SecureDongle
    retcode = None

    for attempt in range(retry_count):
        p1, p2, p3, p4 = (c_int(value) for value in PASSWORDS)
        handle = c_int(0)
        lp1 = c_int(0)
        lp2 = c_int(0)
        buff = bytes(1024)

        retcode = secure_dongle(
            SD_FIND,
            byref(handle),
            byref(lp1),
            byref(lp2),
            byref(p1),
            byref(p2),
            byref(p3),
            byref(p4),
            buff,
        )

        if retcode == 0:
            break

        if attempt < retry_count - 1:
            time.sleep(retry_interval)

    return retcode


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dll", required=True)
    parser.add_argument("--retry-count", type=int, default=3)
    parser.add_argument("--retry-interval", type=float, default=1)
    args = parser.parse_args()

    try:
        retcode = check_dongle(
            args.dll,
            max(args.retry_count, 1),
            max(args.retry_interval, 0),
        )
        emit(
            {
                "ok": retcode == 0,
                "retcode": retcode,
                "checkedAt": utc_now(),
            }
        )
    except Exception as exc:
        emit(
            {
                "ok": False,
                "retcode": None,
                "checkedAt": utc_now(),
                "error": str(exc),
            }
        )
        raise SystemExit(2)


if __name__ == "__main__":
    main()
