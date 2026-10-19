/** Independent resource and checkpoint failures share presentation, not lifetimes. */
export class AuthoredFailures {
 constructor(){this.kinds=new Set();}
 fail(kind){this.kinds.add(kind==='checkpoint'?'checkpoint':'resource');}
 clear(kind){this.kinds.delete(kind);}
 get any(){return this.kinds.size>0;}
}
