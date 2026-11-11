/** Original Listening interfaces own their styles independently of site chrome. */
export function isolatedListeningStyle(style){
 // Site-wide CSS must never change a Listening test's internal interface.
 const reset=`
:host{all:initial;display:block;min-height:0;min-width:0;flex:1;contain:layout style;isolation:isolate;direction:ltr;color-scheme:light;font:16px Sora,Inter,Arial,sans-serif;line-height:normal;letter-spacing:normal;text-align:start;text-transform:none}
.la-listening-source{all:initial;display:block;direction:ltr;font:16px Sora,Inter,Arial,sans-serif;text-align:start}
`;
 return reset+style.replace(/:root\b/g,':host')
  .replace(/(^|})\s*html\s*,\s*body\s*\{/g,'$1\n.la-listening-source{');
}
