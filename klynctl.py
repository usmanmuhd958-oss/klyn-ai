import sys
import json
import os
import argparse

STATE_FILE = os.path.expanduser("~/klyn-ai-os/klyn_state.json")

def load_state():
    if not os.path.exists(STATE_FILE):
        print("❌ [KLYNCTL] Error: No active KLYN OS state found. Run a workflow first.")
        sys.exit(1)
    with open(STATE_FILE, 'r') as f:
        return json.load(f)

def show_status():
    state = load_state()
    print("\n🖥️  === KLYN AI OS ACTIVE CORE REGISTER ===")
    print(f"{'TASK ID':<15} | {'ASSIGNED AGENT':<15} | {'STATUS':<12}")
    print("-" * 50)
    for task_id, data in state.items():
        status = data['status']
        # Add some color formatting based on status
        if status == "COMPLETED":
            status_str = "✅ COMPLETED"
        elif status == "FAILED":
            status_str = "🚨 FAILED"
        elif status == "RUNNING":
            status_str = "⚡ RUNNING"
        else:
            status_str = "⏳ PENDING"
            
        print(f"{task_id:<15} | {data['assigned_agent']:<15} | {status_str:<12}")
    print("")

def inspect_task(task_id):
    state = load_state()
    if task_id not in state:
        print(f"❌ [KLYNCTL] Task '{task_id}' not found in registry.")
        sys.exit(1)
    print(json.dumps(state[task_id], indent=2))

def main():
    parser = argparse.ArgumentParser(description="KLYN AI OS Control Plane Engine")
    subparsers = parser.add_subparsers(dest="command")

    # Status command
    subparsers.add_parser("status", help="Get runtime status of the OS state registry")

    # Inspect command
    inspect_parser = subparsers.add_parser("inspect", help="Inspect detailed JSON metadata of a specific task")
    inspect_parser.add_argument("task_id", type=str, help="The ID of the task to inspect")

    args = parser.parse_args()

    if args.command == "status":
        show_status()
    elif args.command == "inspect":
        inspect_task(args.task_id)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
