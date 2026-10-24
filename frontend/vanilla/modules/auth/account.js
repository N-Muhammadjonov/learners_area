import {renderOnboarding} from './onboarding.js';
import {renderPending} from './pending.js';
import {pendingResult} from '../../js/adapters/account.js';
import {viewData,requireFields} from '../../js/adapters/frontend.js';
export async function mount(context){if(context.url.pathname==='/onboarding')context.root.append(renderOnboarding(context));else context.root.append(renderPending(context,pendingResult(await viewData('/pending',context.signal))));}
