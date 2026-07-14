'use strict';class EventBus{constructor(){this._handlers=new Map()}on(event,handler){if(!this._handlers.has(event))this._handlers.set(event,[]);this._handlers.get(event).push(handler)}emit(event,data,correlId){const handlers=this._handlers.get(event)||[];handlers.forEach(h=>h(data,correlId))}}
let instance;function getEventBus(){if(!instance)instance=new EventBus();return instance}
const LIFECYCLE_EVENT={}
module.exports={getEventBus,LIFECYCLE_EVENT}
