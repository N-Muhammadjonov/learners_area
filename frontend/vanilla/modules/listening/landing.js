/** Source: src/app/app/(shell)/listening/page.tsx — open the Listening Tests catalogue by default. */
export function mount({navigate,signal}) {
  if(signal.aborted)return;
  void navigate('/app/listening/tests',{replace:true});
}
