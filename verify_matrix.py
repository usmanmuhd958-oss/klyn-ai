import os
import json
import sys

class KlynMultiModelMatrix:
    def __init__(self):
        # Gather environment states for all 2026 elite engines
        self.matrix_registry = {
            "Opus 4.8 (High Thinking)": {
                "env_key": "ANTHROPIC_API_KEY",
                "target_model": os.getenv("CLAUDE_MODEL", "claude-4.8-opus"),
                "specialty": "High Reasoning + Ultra Fast Speed",
                "rank": "🥇 Speed/Logic King"
            },
            "GPT 5.5 Pro (Flagship)": {
                "env_key": "OPENAI_API_KEY",
                "target_model": os.getenv("KLYN_MODEL", "gpt-5.5-pro"),
                "specialty": "Multi-Agent DAG Orchestration",
                "rank": "🥈 Core OS Kernel Driver"
            },
            "Gemini 3.1 Pro (Google)": {
                "env_key": "GEMINI_API_KEY",
                "target_model": os.getenv("GEMINI_MODEL", "gemini-3.1-pro"),
                "specialty": "Deep Reasoning + Massive Context Window",
                "rank": "🥉 Context/Token Beast"
            },
            "DeepSeek R1 / V3.1": {
                "env_key": "DEEPSEEK_API_KEY",
                "target_model": os.getenv("DEEPSEEK_MODEL", "deepseek-r1"),
                "specialty": "Advanced Mathematics & Hyper-Low Cost",
                "rank": "💰 Computational Efficiency"
            }
        }

    def display_active_dashboard(self):
        """Renders a beautifully structured terminal dashboard of the 2026 roster."""
        print("\n🌐 ======================================================================= 🌐")
        print("         ⚡ KLYN AI OS -- MULTI-PROVIDER 2026 ELITE ROUTING MATRIX ⚡")
        print("🌐 ======================================================================= 🌐\n")
        
        print(f"{'ENGINE / PROVIDER':<26} | {'ACTIVE MODEL':<16} | {'STATUS':<10} | {'SPECIALIZATION'}")
        print("-" * 90)

        for name, profile in self.matrix_registry.items():
            key_val = os.getenv(profile["env_key"], "NOT_SET")
            
            # Smart detection of environment variables status
            if key_val != "NOT_SET" and "your_actual" not in key_val:
                status = "🟢 ON-LINE"
            else:
                # If OpenAI key is active, treat others as ready for dynamic routing
                if os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_API_KEY") != "NOT_SET":
                    status = "🔵 ROUTABLE"
                else:
                    status = "⚠️  OFFLINE"

            print(f"{name:<26} | {profile['target_model']:<16} | {status:<10} | {profile['specialty']}")
        
        print("\n📊 === CORE SYSTEM CAPABILITY PROFILES ===")
        print("-" * 65)
        for name, profile in self.matrix_registry.items():
            print(f"-> {profile['rank']:<25} :: Unified Route Mapping via -> {profile['target_model']}")
        print("-------------------------------------------------------------------------\n")

if __name__ == "__main__":
    matrix = KlynMultiModelMatrix()
    matrix.display_active_dashboard()
