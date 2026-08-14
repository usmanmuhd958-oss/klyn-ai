
export type Role =
"owner" |
"admin" |
"developer" |
"viewer";


const permissions={
owner:["*"],
admin:[
"edit",
"deploy",
"manage"
],
developer:[
"edit"
],
viewer:[
"read"
]
};


export function can(
role:Role,
action:string
){

return (
permissions[role].includes("*") ||
permissions[role].includes(action)
);

}

