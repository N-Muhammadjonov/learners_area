import {renderOnboarding} from './onboarding.js';
import {renderPending} from './pending.js';
import {viewData,requireFields} from '../../js/adapters/frontend.js';
export async function mount(context){if(context.url.pathname==='/onboarding')context.root.append(renderOnboarding(context));else context.root.append(renderPending(context,requireFields(await viewData('/pending',context.signal),['openRequest'])));}
