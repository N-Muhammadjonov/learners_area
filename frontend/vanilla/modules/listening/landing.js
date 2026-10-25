/** Source: src/app/app/(shell)/listening/page.tsx — server redirects to first learner lesson tab. */
export function mount({navigate,signal}) {
  if(signal.aborted)return;
  void navigate('/app/listening/lessons',{replace:true});
}
