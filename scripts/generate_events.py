import json
import random
import time
import urllib.request


API_URL = "http://localhost:8000/api/events"
SERVICES = {
    "checkout-api": 320,
    "catalog-service": 150,
    "auth-service": 90,
}


def send_event() -> None:
    service = random.choice(list(SERVICES))
    roll = random.random()
    status = "error" if roll < 0.12 else "warning" if roll < 0.25 else "success"
    latency = SERVICES[service] + random.randint(-40, 180) + (random.randint(650, 1400) if status == "error" else 0)
    message = {
        "success": "Request completed",
        "warning": "Latency exceeded service target",
        "error": "Upstream dependency timed out",
    }[status]
    payload = json.dumps(
        {
            "service": service,
            "event_type": "request",
            "status": status,
            "latency_ms": max(0, latency),
            "message": message,
        }
    ).encode()
    request = urllib.request.Request(API_URL, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
    print(f"{result['status']:7} {result['service']:18} {result['latency_ms']:4}ms")


if __name__ == "__main__":
    print("Sending demo telemetry. Press Ctrl+C to stop.")
    try:
        while True:
            send_event()
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopped.")

