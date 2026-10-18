/** Source-equivalent presentation categories; fixed dictionary strings only. */
export function failure(error,dict,known={}){
 if(known[error?.code])return known[error.code];
 if(error?.status===429)return dict.auth.errorRateLimited??dict.auth.errorServer;
 if(error?.status>=500)return dict.auth.errorServer;
 if(error?.name==='TimeoutError')return dict.auth.errorTimeout??dict.auth.errorNetwork;
 return error?.status ? dict.auth.errorUnknown??dict.auth.errorServer : dict.auth.errorNetwork;
}
