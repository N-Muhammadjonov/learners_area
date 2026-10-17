import Link from 'next/link';
import type {Dictionary} from '@/lib/i18n/en';
export function ListeningSequenceLocked({dict,mcq=false}:{dict:Dictionary;mcq?:boolean}){
 const t=dict.listening.academic;
 return <section className="card space-y-3 p-6" data-listening-sequence-locked>
  <h1 className="text-xl font-semibold">🔒 {t.locked}</h1>
  <p>{mcq?dict.listening.mcqProgram.lockedHint:t.lockedHint}</p>
  <Link className="btn-secondary" href={mcq?'/app/listening/mcq':'/app/listening/academic'}>{mcq?dict.listening.mcqProgram.title:t.title}</Link>
 </section>;
}
