
import type { GeneratedTest } from "@/components/testing/testing.types";

export function generateTests(
 file:string
):GeneratedTest[] {

 return [
 {
  id:crypto.randomUUID(),
  file,
  type:"unit",
  description:
   "AI generated unit validation",
  status:"pending",
  confidence:92
 },
 {
  id:crypto.randomUUID(),
  file,
  type:"integration",
  description:
   "Dependency interaction validation",
  status:"pending",
  confidence:85
 }
 ];

}

