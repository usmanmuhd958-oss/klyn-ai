"use client";

const agents = [
  {
    name: "Architect",
    role: "System Design",
    status: "Planning"
  },
  {
    name: "Frontend Builder",
    role: "UI Engineering",
    status: "Working"
  },
  {
    name: "Backend Builder",
    role: "API Engineering",
    status: "Ready"
  },
  {
    name: "Guardian",
    role: "Security",
    status: "Monitoring"
  },
  {
    name: "QA Engineer",
    role: "Testing",
    status: "Waiting"
  }
];

export default function AgentOrchestra() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="font-semibold">
        AGENT ORCHESTRA
      </h2>

      <div className="mt-6 space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="rounded-xl border border-white/10 p-3"
          >
            <div className="font-medium">
              {agent.name}
            </div>

            <div className="text-xs text-gray-400">
              {agent.role}
            </div>

            <div className="mt-1 text-xs text-green-400">
              {agent.status}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
