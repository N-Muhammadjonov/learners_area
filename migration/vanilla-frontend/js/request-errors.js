/** Source-equivalent presentation categories; fixed dictionary strings only. */
export function failure(error,dict,known={}){
 if(error?.status===429)return dict.auth.errorRateLimited??dict.auth.errorServer;
 if(Object.hasOwn(known,error?.code)&&typeof known[error.code]==='string')return known[error.code];
 if(error?.code==='invalid_response')return dict.auth.errorServer;
 if(error?.status>=500)return dict.auth.errorServer;
 if(error?.name==='TimeoutError')return dict.auth.errorTimeout??dict.auth.errorNetwork;
 return error?.status ? dict.auth.errorUnknown??dict.auth.errorServer : dict.auth.errorNetwork;
}
