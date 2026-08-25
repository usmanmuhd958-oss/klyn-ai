e client";


const intelligence = [
	  {
		      name:"Active Agents",
		          value:"6"
			    },
			      {
				          name:"System Health",
					      value:"99.8%"
					        },
						  {
							      name:"Code Coverage",
							          value:"94%"
								    },
								      {
									          name:"Risk",
										      value:"Low"
										        }
];


export default function IntelligencePanel(){

	return (

		<aside className="
		rounded-2xl
		border
		border-white/10
		bg-white/5
		p-5
		">

		<h2 className="font-semibold">
		INTELLIGENCE
		</h2>


		<div className="mt-6 space-y-3">

		{
			intelligence.map(item=>(

				<div
				key={item.name}
				className="
				rounded-xl
				border
				border-white/10
				p-4
				"
				>

				<p className="text-xs text-gray-400">
				{item.name}
				</p>

				<p className="mt-1 text-xl font-bold">
				{item.value}
				</p>

				</div>

			))
		}

		</div>

		</aside>

	);

}
