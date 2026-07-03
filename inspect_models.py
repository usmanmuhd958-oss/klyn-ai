import os
import json
import urllib.request
import asyncio
import sys

class KlynModelInspector:
    def __init__(self):
        # Fetch current environment settings from Termux configuration
        self.api_key = os.getenv("OPENAI_API_KEY", "NOT_SET")
        self.api_url = os.getenv("KLYN_API_URL", "https://api.openai.com/v1")
        self.active_model = os.getenv("KLYN_MODEL", "NOT_SET")

    def display_environment_status(self):
        """Prints a scannable structural summary of current system variables."""
        print("\n⚙️  === KLYN AI OS ENVIRONMENT INVENTORY ===")
        print(f"CURRENT TARGET MODEL : {self.active_model}")
        print(f"TARGET API ENDPOINT  : {self.api_url}")
        
        # Hide the actual key content for secure telemetry display
        key_status = "🔒 ACTIVE (Key Loaded)" if self.api_key != "NOT_SET" and "your_actual" not in self.api_key else "❌ NOT CONFIGURED"
        print(f"API KEY CREDENTIAL   : {key_status}")
        print("-" * 50)

    async def fetch_available_models(self):
        """Queries the active 2026 engine endpoint to parse all available models."""
        # Ensure endpoint url is properly formatted for target extraction
        base_url = self.api_url.split("/chat")[0]
        models_endpoint = f"{base_url}/models" if not base_url.endswith("/models") else base_url

        if self.api_key == "NOT_SET" or "your_actual" in self.api_key:
            print("⚠️  [INSPECTOR] System is in Local Offline Mode. Listing core supported 2026 matrix profiles:")
            self._print_mock_registry()
            return

        print(f"📡 Requesting live model registry from: {models_endpoint}...")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        req = urllib.request.Request(models_endpoint, headers=headers, method="GET")
        try:
            response = await asyncio.to_thread(urllib.request.urlopen, req, timeout=15)
            res_data = json.loads(response.read().decode("utf-8"))
            
            print("\n🤖 === AVAILABLE 2026 LIVE MODEL MATRIX ===")
            print(f"{'MODEL IDENTIFIER':<35} | {'OWNER/PROVIDER':<15}")
            print("-" * 55)
            
            # Parse OpenAI-compatible models format
            if "data" in res_data:
                for model in res_data["data"]:
                    model_id = model.get("id", "Unknown")
                    owned_by = model.get("owned_by", "System")
                    print(f"{model_id:<35} | {owned_by:<15}")
            print("")
            
        except Exception as e:
            print(f"❌ [INSPECTOR] Failed to fetch live registry. Error details: {str(e)}")
            print("💡 Reverting to local registry view:")
            self._print_mock_registry()

    def _print_mock_registry(self):
        """Fallback list of standard 2026 industry profiles."""
        print(f"\n🖥️  === KLYN CORE PRE-CONFIGURED PROFILES ===")
        print(f"{'MODEL PROFILES':<35} | {'STATUS':<15}")
        print("-" * 55)
        profiles = ["gpt-5.5", "gpt-5-turbo", "gpt-4o", "claude-3-7-sonnet", "llama-3.3-70b"]
        for profile in profiles:
            status = "🎯 SELECTED ACTIVE" if profile == self.active_model else "⏳ AVAILABLE"
            print(f"{profile:<35} | {status:<15}")
        print("")

async def main():
    inspector = KlynModelInspector()
    inspector.display_environment_status()
    await inspector.fetch_available_models()

if __name__ == "__main__":
    asyncio.run(main())
