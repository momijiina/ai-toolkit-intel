"""Collect Intel XPU device info via PyTorch and output JSON to stdout."""
import json
import sys

def main():
    try:
        import torch
    except ImportError:
        print("[]")
        sys.exit(0)

    if not hasattr(torch, "xpu") or not torch.xpu.is_available():
        print("[]")
        sys.exit(0)

    devices = []
    for i in range(torch.xpu.device_count()):
        props = torch.xpu.get_device_properties(i)
        total = props.total_memory // (1024 * 1024)
        free = total
        used = 0
        try:
            info = torch.xpu.mem_get_info(i)
            free = info[0] // (1024 * 1024)
            used = total - free
        except Exception:
            pass
        devices.append({
            "index": i,
            "name": props.name,
            "driver_version": props.driver_version,
            "total_memory": total,
            "free_memory": free,
            "used_memory": used,
        })
    print(json.dumps(devices))


if __name__ == "__main__":
    main()
