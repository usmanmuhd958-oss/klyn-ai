e client";

const modules = [
	  "Workspace",
	    "Repositories",
	      "AI Memory",
	        "Architecture Graph",
		  "Deployments",
		    "Observability"
];

export default function EnterpriseSidebar() {
	  return (
		      <aside className="rounded-2xl border border-white/10 bg-white/5 p-5">

		            <h1 className="text-lg font-bold">
			            KLYN OS
				          </h1>

					        <p className="mt-2 text-xs text-gray-500">
						        Enterprise AI Engineering Platform
							      </p>


							            <nav className="mt-8 space-y-2">
								            {modules.map((module)=>(
										              <button
											                  key={module}
													              className="
														                  w-full
																              rounded-xl
																	                  px-3
																			              py-2
																				                  text-left
																						              text-sm
																							                  text-gray-300
																									              hover:bg-white/10
																										                  "
																												            >
																													                {module}
																															          </button>
																																          ))}
																																	        </nav>

																																		    </aside>
																																		      );

