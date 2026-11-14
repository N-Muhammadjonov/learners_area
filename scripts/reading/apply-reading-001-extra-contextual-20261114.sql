-- General Reading 001 additional context: reviewed contextual vocabulary and existing-row repairs.
-- Idempotent. Source-SHA guarded; only the three canonical passages are touched.
-- Previous learner vocabulary, SRS state and saved source IDs remain unchanged.
-- Requires: public reading_passages, lexical_occurrences, lexemes, lexical_units,
-- lexical_unit_forms, and extensions.digest.
DO $executor$
DECLARE
  v_plan jsonb := $plan${"version":1,"release":"reading-001-extra-contextual-20261114","repository":"N-Muhammadjonov/learners_area","passages":{"1-1":"400a46244f6309060b50c44d8cade0cf48c1aeaa920db936817eec7e42618ce8"},"terms":[{"testNo":1,"passageNo":1,"surface":"faced","partOfSpeech":"verb","translationUz":"duch keldi","definitionEn":"encountered a difficult situation"},{"testNo":1,"passageNo":1,"surface":"battles","partOfSpeech":"noun","translationUz":"janglar","definitionEn":"armed conflicts between opposing forces"},{"testNo":1,"passageNo":1,"surface":"abroad","partOfSpeech":"adverb","translationUz":"xorijda","definitionEn":"in another country"},{"testNo":1,"passageNo":1,"surface":"hungry","partOfSpeech":"adjective","translationUz":"och","definitionEn":"needing food"},{"testNo":1,"passageNo":1,"surface":"malnourished","partOfSpeech":"adjective","translationUz":"to‘yib ovqatlanmagan","definitionEn":"suffering from insufficient nourishment"},{"testNo":1,"passageNo":1,"surface":"government","partOfSpeech":"noun","translationUz":"hukumat","definitionEn":"the governing authority of a country"},{"testNo":1,"passageNo":1,"surface":"established","partOfSpeech":"verb","translationUz":"ta’sis etdi","definitionEn":"set up an award or institution"},{"testNo":1,"passageNo":1,"surface":"prize","partOfSpeech":"noun","translationUz":"mukofot","definitionEn":"a reward given for achievement"},{"testNo":1,"passageNo":1,"surface":"whoever","partOfSpeech":"pronoun","translationUz":"kim bo‘lishidan qat’i nazar","definitionEn":"any person who does something"},{"testNo":1,"passageNo":1,"surface":"find","partOfSpeech":"verb","translationUz":"topmoq","definitionEn":"discover a means or solution"},{"testNo":1,"passageNo":1,"surface":"preserve food","partOfSpeech":"verb phrase","translationUz":"oziq-ovqatni uzoq saqlamoq","definitionEn":"keep food from spoiling for an extended period"},{"testNo":1,"passageNo":1,"surface":"milk","partOfSpeech":"noun","translationUz":"sut","definitionEn":"the white liquid produced by mammals"},{"testNo":1,"passageNo":1,"surface":"meat","partOfSpeech":"noun","translationUz":"go‘sht","definitionEn":"the flesh of animals eaten as food"},{"testNo":1,"passageNo":1,"surface":"fruits","partOfSpeech":"noun","translationUz":"mevalar","definitionEn":"sweet edible produce of plants"},{"testNo":1,"passageNo":1,"surface":"vegetables","partOfSpeech":"noun","translationUz":"sabzavotlar","definitionEn":"edible parts of plants other than fruits"},{"testNo":1,"passageNo":1,"surface":"chef","partOfSpeech":"noun","translationUz":"oshpaz","definitionEn":"a professional cook"},{"testNo":1,"passageNo":1,"surface":"decade","partOfSpeech":"noun","translationUz":"o‘n yil","definitionEn":"a period of ten years"},{"testNo":1,"passageNo":1,"surface":"develop","partOfSpeech":"verb","translationUz":"ishlab chiqmoq","definitionEn":"create a new process or method"},{"testNo":1,"passageNo":1,"surface":"process","partOfSpeech":"noun","translationUz":"jarayon","definitionEn":"a series of actions used to achieve an outcome"},{"testNo":1,"passageNo":1,"surface":"involved","partOfSpeech":"verb","translationUz":"o‘z ichiga olgan","definitionEn":"included something as an integral part of a procedure"},{"testNo":1,"passageNo":1,"surface":"cooking","partOfSpeech":"verb","translationUz":"pishirish","definitionEn":"preparing food with heat"},{"testNo":1,"passageNo":1,"surface":"glass jars","partOfSpeech":"noun phrase","translationUz":"shisha bankalar","definitionEn":"glass containers used for preserving food"},{"testNo":1,"passageNo":1,"surface":"seals","partOfSpeech":"noun","translationUz":"tiqinlar","definitionEn":"closures used to make containers airtight"},{"testNo":1,"passageNo":1,"surface":"cork","partOfSpeech":"noun","translationUz":"po‘kak","definitionEn":"a lightweight material used to seal containers"},{"testNo":1,"passageNo":1,"surface":"airtight","partOfSpeech":"adjective","translationUz":"havo o‘tkazmaydigan","definitionEn":"not allowing air to enter or escape"},{"testNo":1,"passageNo":1,"surface":"published","partOfSpeech":"verb","translationUz":"nashr ettirdi","definitionEn":"made a book publicly available"},{"testNo":1,"passageNo":1,"surface":"book","partOfSpeech":"noun","translationUz":"kitob","definitionEn":"a printed written work"},{"testNo":1,"passageNo":1,"surface":"title","partOfSpeech":"noun","translationUz":"sarlavha","definitionEn":"the name of a book"},{"testNo":1,"passageNo":1,"surface":"translates","partOfSpeech":"verb","translationUz":"tarjima qilinadi","definitionEn":"can be expressed in another language"},{"testNo":1,"passageNo":1,"surface":"preserving","partOfSpeech":"verb","translationUz":"saqlash","definitionEn":"preventing food from spoiling"},{"testNo":1,"passageNo":1,"surface":"animal","partOfSpeech":"adjective","translationUz":"hayvonotga oid","definitionEn":"relating to animals"},{"testNo":1,"passageNo":1,"surface":"vegetable","partOfSpeech":"adjective","translationUz":"o‘simlikka oid","definitionEn":"relating to plants in this context"},{"testNo":1,"passageNo":1,"surface":"substances","partOfSpeech":"noun","translationUz":"moddalar","definitionEn":"materials of a particular type"},{"testNo":1,"passageNo":1,"surface":"several years","partOfSpeech":"noun phrase","translationUz":"bir necha yil","definitionEn":"a number of years"},{"testNo":1,"passageNo":1,"surface":"collected","partOfSpeech":"verb","translationUz":"qo‘lga kiritdi","definitionEn":"received a prize or reward"},{"testNo":1,"passageNo":1,"surface":"prize money","partOfSpeech":"noun phrase","translationUz":"mukofot puli","definitionEn":"money awarded as a prize"},{"testNo":1,"passageNo":1,"surface":"achievement","partOfSpeech":"noun","translationUz":"yutuq","definitionEn":"a successful accomplishment"},{"testNo":1,"passageNo":1,"surface":"escape the notice","partOfSpeech":"verb phrase","translationUz":"e’tiboridan chetda qolmoq","definitionEn":"go unnoticed by a particular person"},{"testNo":1,"passageNo":1,"surface":"merchant","partOfSpeech":"noun","translationUz":"savdogar","definitionEn":"a person engaged in commerce"},{"testNo":1,"passageNo":1,"surface":"inventor","partOfSpeech":"noun","translationUz":"ixtirochi","definitionEn":"a person who creates new devices or processes"},{"testNo":1,"passageNo":1,"surface":"applied for","partOfSpeech":"phrasal verb","translationUz":"ariza topshirdi","definitionEn":"formally requested something"},{"testNo":1,"passageNo":1,"surface":"patent","partOfSpeech":"noun","translationUz":"patent","definitionEn":"a legal right granted for an invention"},{"testNo":1,"passageNo":1,"surface":"techniques","partOfSpeech":"noun","translationUz":"usullar","definitionEn":"practical methods for accomplishing an activity"},{"testNo":1,"passageNo":1,"surface":"similar","partOfSpeech":"adjective","translationUz":"o‘xshash","definitionEn":"resembling something else"},{"testNo":1,"passageNo":1,"surface":"although","partOfSpeech":"conjunction","translationUz":"garchi ... bo‘lsa-da","definitionEn":"introducing a contrasting fact"},{"testNo":1,"passageNo":1,"surface":"adapted","partOfSpeech":"verb","translationUz":"moslashtirdi","definitionEn":"modified a method to suit a new purpose"},{"testNo":1,"passageNo":1,"surface":"model","partOfSpeech":"noun","translationUz":"usul andozasi","definitionEn":"an approach used as a template"},{"testNo":1,"passageNo":1,"surface":"include","partOfSpeech":"verb","translationUz":"kiritmoq","definitionEn":"make part of a process"},{"testNo":1,"passageNo":1,"surface":"tin vessels","partOfSpeech":"noun phrase","translationUz":"tunuka idishlar","definitionEn":"containers made from tin-plated metal"},{"testNo":1,"passageNo":1,"surface":"discoveries","partOfSpeech":"noun","translationUz":"kashfiyotlar","definitionEn":"important findings"},{"testNo":1,"passageNo":1,"surface":"initially","partOfSpeech":"adverb","translationUz":"dastlab","definitionEn":"at the beginning"},{"testNo":1,"passageNo":1,"surface":"produced","partOfSpeech":"verb","translationUz":"ishlab chiqarilgan","definitionEn":"manufactured for a purpose"},{"testNo":1,"passageNo":1,"surface":"soldiers","partOfSpeech":"noun","translationUz":"askarlar","definitionEn":"members of the armed forces"},{"testNo":1,"passageNo":1,"surface":"explorers","partOfSpeech":"noun","translationUz":"sayohatchilar","definitionEn":"people who travel to discover new places"},{"testNo":1,"passageNo":1,"surface":"aware","partOfSpeech":"adjective","translationUz":"xabardor","definitionEn":"knowing that something exists"},{"testNo":1,"passageNo":1,"surface":"existence","partOfSpeech":"noun","translationUz":"mavjudlik","definitionEn":"the state of being real or present"},{"testNo":1,"passageNo":1,"surface":"bacteria","partOfSpeech":"noun","translationUz":"bakteriyalar","definitionEn":"microscopic single-celled organisms"},{"testNo":1,"passageNo":1,"surface":"canning companies","partOfSpeech":"noun phrase","translationUz":"konserva ishlab chiqaruvchi kompaniyalar","definitionEn":"companies producing preserved foods in cans"},{"testNo":1,"passageNo":1,"surface":"turned bad","partOfSpeech":"verb phrase","translationUz":"aynib qolgan","definitionEn":"become spoiled and unfit to eat"},{"testNo":1,"passageNo":1,"surface":"exactly","partOfSpeech":"adverb","translationUz":"aniq","definitionEn":"precisely"},{"testNo":1,"passageNo":1,"surface":"newspapers","partOfSpeech":"noun","translationUz":"gazetalar","definitionEn":"periodical publications containing news"},{"testNo":1,"passageNo":1,"surface":"accounts","partOfSpeech":"noun","translationUz":"xabarlar","definitionEn":"written reports describing events"},{"testNo":1,"passageNo":1,"surface":"food poisoning","partOfSpeech":"noun phrase","translationUz":"ovqatdan zaharlanish","definitionEn":"illness caused by contaminated food"},{"testNo":1,"passageNo":1,"surface":"fatal disease","partOfSpeech":"noun phrase","translationUz":"o‘limga olib keluvchi kasallik","definitionEn":"a disease that can cause death"},{"testNo":1,"passageNo":1,"surface":"botulism","partOfSpeech":"noun","translationUz":"botulizm","definitionEn":"a serious illness caused by bacterial toxin"},{"testNo":1,"passageNo":1,"surface":"resulting from","partOfSpeech":"verb phrase","translationUz":"oqibatida kelib chiqqan","definitionEn":"caused by a preceding event"},{"testNo":1,"passageNo":1,"surface":"suspicion","partOfSpeech":"noun","translationUz":"shubha","definitionEn":"distrust or uncertainty about safety"},{"testNo":1,"passageNo":1,"surface":"fear","partOfSpeech":"noun","translationUz":"xavfsirash","definitionEn":"anxiety about possible danger"},{"testNo":1,"passageNo":1,"surface":"manufacturer","partOfSpeech":"noun","translationUz":"ishlab chiqaruvchi","definitionEn":"a business producing manufactured goods"},{"testNo":1,"passageNo":1,"surface":"realized","partOfSpeech":"verb","translationUz":"anglab yetdi","definitionEn":"understood the importance of something"},{"testNo":1,"passageNo":1,"surface":"business","partOfSpeech":"noun","translationUz":"biznes","definitionEn":"commercial activity carried out for profit"},{"testNo":1,"passageNo":1,"surface":"insisted on","partOfSpeech":"phrasal verb","translationUz":"qat’iy talab qildi","definitionEn":"demanded that an activity be carried out"},{"testNo":1,"passageNo":1,"surface":"weekly manicures","partOfSpeech":"noun phrase","translationUz":"haftalik manikyur","definitionEn":"nail care performed every week"},{"testNo":1,"passageNo":1,"surface":"canning-factory workers","partOfSpeech":"noun phrase","translationUz":"konserva zavodi ishchilari","definitionEn":"employees working at a canning plant"},{"testNo":1,"passageNo":1,"surface":"ensure","partOfSpeech":"verb","translationUz":"ta’minlamoq","definitionEn":"make certain that something happens"},{"testNo":1,"passageNo":1,"surface":"beneath","partOfSpeech":"preposition","translationUz":"ostida","definitionEn":"below something"},{"testNo":1,"passageNo":1,"surface":"employees' fingernails","partOfSpeech":"noun phrase","translationUz":"xodimlarning tirnoqlari","definitionEn":"the fingernails of company employees"},{"testNo":1,"passageNo":1,"surface":"required","partOfSpeech":"verb","translationUz":"talab qilingan","definitionEn":"made obligatory"},{"testNo":1,"passageNo":1,"surface":"shower","partOfSpeech":"verb","translationUz":"dush qabul qilmoq","definitionEn":"wash oneself under running water"},{"testNo":1,"passageNo":1,"surface":"clothing","partOfSpeech":"noun","translationUz":"kiyim-kechak","definitionEn":"garments worn by people"},{"testNo":1,"passageNo":1,"surface":"regularly","partOfSpeech":"adverb","translationUz":"muntazam ravishda","definitionEn":"at consistent intervals"},{"testNo":1,"passageNo":1,"surface":"era","partOfSpeech":"noun","translationUz":"davr","definitionEn":"a period of history"},{"testNo":1,"passageNo":1,"surface":"hygiene","partOfSpeech":"noun","translationUz":"gigiyena","definitionEn":"practices that maintain cleanliness and health"},{"testNo":1,"passageNo":1,"surface":"universally adopted","partOfSpeech":"verb phrase","translationUz":"hamma joyda joriy etilgan","definitionEn":"accepted and put into use everywhere"},{"testNo":1,"passageNo":1,"surface":"considered","partOfSpeech":"verb","translationUz":"deb hisoblangan","definitionEn":"regarded in a particular way"},{"testNo":1,"passageNo":1,"surface":"nuisance","partOfSpeech":"noun","translationUz":"ortiqcha tashvish","definitionEn":"something that causes inconvenience"},{"testNo":1,"passageNo":1,"surface":"consumers","partOfSpeech":"noun","translationUz":"iste’molchilar","definitionEn":"people who use products"},{"testNo":1,"passageNo":1,"surface":"chemical additives","partOfSpeech":"noun phrase","translationUz":"kimyoviy qo‘shimchalar","definitionEn":"substances added to food for a chemical effect"},{"testNo":1,"passageNo":1,"surface":"sodium benzoate","partOfSpeech":"noun phrase","translationUz":"natriy benzoat","definitionEn":"a chemical compound used as a food preservative"},{"testNo":1,"passageNo":1,"surface":"formaldehydes","partOfSpeech":"noun","translationUz":"formaldegidlar","definitionEn":"chemical substances used as preservatives but harmful to health"},{"testNo":1,"passageNo":1,"surface":"cause cancer","partOfSpeech":"verb phrase","translationUz":"saraton kasalligiga sabab bo‘lmoq","definitionEn":"produce the disease cancer"},{"testNo":1,"passageNo":1,"surface":"larger","partOfSpeech":"adjective","translationUz":"yirikroq","definitionEn":"greater in size or scale"},{"testNo":1,"passageNo":1,"surface":"installed","partOfSpeech":"verb","translationUz":"o‘rnatgan","definitionEn":"set up equipment for use"},{"testNo":1,"passageNo":1,"surface":"expensive","partOfSpeech":"adjective","translationUz":"qimmatbaho","definitionEn":"costing a lot of money"},{"testNo":1,"passageNo":1,"surface":"steam-retort technology","partOfSpeech":"noun phrase","translationUz":"bug‘ avtoklavi texnologiyasi","definitionEn":"industrial food sterilisation using pressurised steam"},{"testNo":1,"passageNo":1,"surface":"steam engines","partOfSpeech":"noun phrase","translationUz":"bug‘ dvigatellari","definitionEn":"engines powered by steam"},{"testNo":1,"passageNo":1,"surface":"pressure","partOfSpeech":"noun","translationUz":"bosim","definitionEn":"force exerted on a surface"},{"testNo":1,"passageNo":1,"surface":"temperatures","partOfSpeech":"noun","translationUz":"haroratlar","definitionEn":"measurements of hotness or coldness"},{"testNo":1,"passageNo":1,"surface":"high enough","partOfSpeech":"adjective phrase","translationUz":"yetarlicha yuqori","definitionEn":"sufficiently high to produce a result"},{"testNo":1,"passageNo":1,"surface":"batches","partOfSpeech":"noun","translationUz":"mahsulot partiyalari","definitionEn":"quantities processed together"},{"testNo":1,"passageNo":1,"surface":"advanced technique","partOfSpeech":"noun phrase","translationUz":"ilg‘or usul","definitionEn":"a sophisticated method"},{"testNo":1,"passageNo":1,"surface":"explode","partOfSpeech":"verb","translationUz":"portlab ketmoq","definitionEn":"burst violently"},{"testNo":1,"passageNo":1,"surface":"shelf","partOfSpeech":"noun","translationUz":"javon","definitionEn":"a flat storage surface"},{"testNo":1,"passageNo":1,"surface":"contents","partOfSpeech":"noun","translationUz":"ichidagi mahsulot","definitionEn":"what is held inside a container"},{"testNo":1,"passageNo":1,"surface":"mysteriously","partOfSpeech":"adverb","translationUz":"g‘alati tarzda","definitionEn":"in an unexplained way"},{"testNo":1,"passageNo":1,"surface":"sour","partOfSpeech":"verb","translationUz":"aynib qolmoq","definitionEn":"become spoiled and acidic"},{"testNo":1,"passageNo":1,"surface":"manufacturers","partOfSpeech":"noun","translationUz":"ishlab chiqaruvchilar","definitionEn":"businesses producing goods"},{"testNo":1,"passageNo":1,"surface":"relied on","partOfSpeech":"phrasal verb","translationUz":"tayanishgan","definitionEn":"depended on a method"},{"testNo":1,"passageNo":1,"surface":"open kettle method","partOfSpeech":"noun phrase","translationUz":"ochiq qozon usuli","definitionEn":"a method of cooking food before sealing it hot in jars"},{"testNo":1,"passageNo":1,"surface":"consistent results","partOfSpeech":"noun phrase","translationUz":"barqaror natijalar","definitionEn":"outcomes that do not vary greatly"},{"testNo":1,"passageNo":1,"surface":"eventually","partOfSpeech":"adverb","translationUz":"nihoyat","definitionEn":"after a long time or process"},{"testNo":1,"passageNo":1,"surface":"banded together","partOfSpeech":"phrasal verb","translationUz":"birlashdilar","definitionEn":"joined forces for a common purpose"},{"testNo":1,"passageNo":1,"surface":"scientific principles","partOfSpeech":"noun phrase","translationUz":"ilmiy qoidalar","definitionEn":"fundamental rules established through science"},{"testNo":1,"passageNo":1,"surface":"affecting","partOfSpeech":"verb","translationUz":"ta’sir qiluvchi","definitionEn":"having an effect on"},{"testNo":1,"passageNo":1,"surface":"launched","partOfSpeech":"verb","translationUz":"tashkil etdilar","definitionEn":"started a new research organisation"},{"testNo":1,"passageNo":1,"surface":"Research Laboratory","partOfSpeech":"noun phrase","translationUz":"ilmiy-tadqiqot laboratoriyasi","definitionEn":"a laboratory where research is conducted"},{"testNo":1,"passageNo":1,"surface":"look into","partOfSpeech":"phrasal verb","translationUz":"tadqiq qilmoq","definitionEn":"investigate something carefully"},{"testNo":1,"passageNo":1,"surface":"elusive","partOfSpeech":"adjective","translationUz":"murakkab va aniqlash qiyin","definitionEn":"difficult to identify or understand"},{"testNo":1,"passageNo":1,"surface":"bacteriology","partOfSpeech":"noun","translationUz":"bakteriologiya","definitionEn":"the scientific study of bacteria"},{"testNo":1,"passageNo":1,"surface":"responsible for","partOfSpeech":"adjective phrase","translationUz":"sababchi bo‘lgan","definitionEn":"causing a particular result"},{"testNo":1,"passageNo":1,"surface":"spoiled canned food","partOfSpeech":"noun phrase","translationUz":"aynigan konservalar","definitionEn":"canned food that has become unfit for consumption"},{"testNo":1,"passageNo":1,"surface":"resolve","partOfSpeech":"verb","translationUz":"hal etmoq","definitionEn":"find an answer to a problem"},{"testNo":1,"passageNo":1,"surface":"nutritional value","partOfSpeech":"noun phrase","translationUz":"ozuqaviy qiymat","definitionEn":"the nutrient content of food"},{"testNo":1,"passageNo":1,"surface":"texture","partOfSpeech":"noun","translationUz":"mahsulot tuzilishi","definitionEn":"the physical consistency of a food"},{"testNo":1,"passageNo":1,"surface":"trial and error","partOfSpeech":"noun phrase","translationUz":"sinov va xatolar","definitionEn":"learning through unsuccessful and successful attempts"},{"testNo":1,"passageNo":1,"surface":"avoid","partOfSpeech":"verb","translationUz":"oldini olmoq","definitionEn":"prevent something from happening"},{"testNo":1,"passageNo":1,"surface":"approach","partOfSpeech":"noun","translationUz":"yondashuv","definitionEn":"a method used to solve a problem"},{"testNo":1,"passageNo":1,"surface":"sacrificed flavor","partOfSpeech":"verb phrase","translationUz":"ta’mini qurbon qilgan","definitionEn":"lost desirable taste in order to gain something else"},{"testNo":1,"passageNo":1,"surface":"palatability","partOfSpeech":"noun","translationUz":"mazalilik","definitionEn":"the quality of tasting pleasant"},{"testNo":1,"passageNo":1,"surface":"at cross-purposes","partOfSpeech":"idiom","translationUz":"bir-biriga zid","definitionEn":"in conflict with one another"},{"testNo":1,"passageNo":1,"surface":"remarks","partOfSpeech":"verb","translationUz":"ta’kidlaydi","definitionEn":"makes a comment"},{"testNo":1,"passageNo":1,"surface":"food historian","partOfSpeech":"noun phrase","translationUz":"oziq-ovqat tarixchisi","definitionEn":"a researcher studying food history"},{"testNo":1,"passageNo":1,"surface":"for instance","partOfSpeech":"phrase","translationUz":"masalan","definitionEn":"used to introduce an example"},{"testNo":1,"passageNo":1,"surface":"string beans","partOfSpeech":"noun phrase","translationUz":"ko‘k loviya","definitionEn":"green beans eaten as vegetables"},{"testNo":1,"passageNo":1,"surface":"leach out","partOfSpeech":"phrasal verb","translationUz":"yuvilib chiqib ketmoq","definitionEn":"be removed by liquid"},{"testNo":1,"passageNo":1,"surface":"unattractive","partOfSpeech":"adjective","translationUz":"yoqimsiz","definitionEn":"not pleasing in appearance"},{"testNo":1,"passageNo":1,"surface":"grayish-toned","partOfSpeech":"adjective","translationUz":"kulrang tusli","definitionEn":"having a somewhat grey colour"},{"testNo":1,"passageNo":1,"surface":"addition of salt","partOfSpeech":"noun phrase","translationUz":"tuz qo‘shilishi","definitionEn":"the act of adding salt"},{"testNo":1,"passageNo":1,"surface":"maintaining","partOfSpeech":"verb","translationUz":"saqlab qolish","definitionEn":"keeping something in its desired condition"},{"testNo":1,"passageNo":1,"surface":"visual appeal","partOfSpeech":"noun phrase","translationUz":"tashqi jozibadorlik","definitionEn":"the attractiveness of something's appearance"},{"testNo":1,"passageNo":1,"surface":"restoring","partOfSpeech":"verb","translationUz":"qayta tiklash","definitionEn":"bringing back something that was lost"},{"testNo":1,"passageNo":1,"surface":"taste","partOfSpeech":"noun","translationUz":"ta’m","definitionEn":"the flavour of food"},{"testNo":1,"passageNo":1,"surface":"major","partOfSpeech":"adjective","translationUz":"yirik","definitionEn":"very important or significant"},{"testNo":1,"passageNo":1,"surface":"innovations","partOfSpeech":"noun","translationUz":"yangiliklar","definitionEn":"newly introduced inventions or methods"},{"testNo":1,"passageNo":1,"surface":"aseptic processing","partOfSpeech":"noun phrase","translationUz":"aseptik ishlov berish","definitionEn":"sterilisation and packaging in separate sterile processes"},{"testNo":1,"passageNo":1,"surface":"sterilizing","partOfSpeech":"verb","translationUz":"sterilizatsiya qilish","definitionEn":"removing all microorganisms"},{"testNo":1,"passageNo":1,"surface":"separately","partOfSpeech":"adverb","translationUz":"alohida","definitionEn":"independently of something else"},{"testNo":1,"passageNo":1,"surface":"invented","partOfSpeech":"verb","translationUz":"ixtiro qilingan","definitionEn":"created as a new process"},{"testNo":1,"passageNo":1,"surface":"juices","partOfSpeech":"noun","translationUz":"sharbatlar","definitionEn":"liquids extracted from fruit or vegetables"},{"testNo":1,"passageNo":1,"surface":"volumes","partOfSpeech":"noun","translationUz":"hajmlar","definitionEn":"measured amounts of material"},{"testNo":1,"passageNo":1,"surface":"precise temperature","partOfSpeech":"noun phrase","translationUz":"aniq belgilangan harorat","definitionEn":"an exactly controlled heating level"},{"testNo":1,"passageNo":1,"surface":"overcooking","partOfSpeech":"noun","translationUz":"ortiqcha pishirish","definitionEn":"cooking for too long"},{"testNo":1,"passageNo":1,"surface":"nutrients","partOfSpeech":"noun","translationUz":"ozuqa moddalari","definitionEn":"substances that nourish the body"},{"testNo":1,"passageNo":1,"surface":"scientist","partOfSpeech":"noun","translationUz":"olim","definitionEn":"a person conducting scientific research"},{"testNo":1,"passageNo":1,"surface":"recognition","partOfSpeech":"noun","translationUz":"e’tirof","definitionEn":"public appreciation of achievements"},{"testNo":1,"passageNo":1,"surface":"workable","partOfSpeech":"adjective","translationUz":"amalda qo‘llash mumkin bo‘lgan","definitionEn":"feasible for real-world use"},{"testNo":1,"passageNo":1,"surface":"industrial scale","partOfSpeech":"noun phrase","translationUz":"sanoat miqyosi","definitionEn":"the size of production used in industry"},{"testNo":1,"passageNo":1,"surface":"despite","partOfSpeech":"preposition","translationUz":"qaramay","definitionEn":"without being prevented by a contrasting fact"},{"testNo":1,"passageNo":1,"surface":"modern alternatives","partOfSpeech":"noun phrase","translationUz":"zamonaviy muqobillar","definitionEn":"recently developed options"},{"testNo":1,"passageNo":1,"surface":"reigns supreme","partOfSpeech":"idiom","translationUz":"hanuz tengsiz bo‘lib qolmoqda","definitionEn":"continues to be better than alternatives"},{"testNo":1,"passageNo":1,"surface":"long-term storage","partOfSpeech":"noun phrase","translationUz":"uzoq muddat saqlash","definitionEn":"keeping products for an extended period"},{"testNo":1,"passageNo":1,"surface":"centuries","partOfSpeech":"noun","translationUz":"asrlar","definitionEn":"periods of a hundred years"},{"testNo":1,"passageNo":1,"surface":"solution","partOfSpeech":"noun","translationUz":"yechim","definitionEn":"an answer to a problem"},{"testNo":1,"passageNo":1,"surface":"preservation","partOfSpeech":"noun","translationUz":"saqlash","definitionEn":"keeping food from spoiling"},{"testNo":1,"passageNo":1,"surface":"foodstuffs","partOfSpeech":"noun","translationUz":"oziq-ovqat mahsulotlari","definitionEn":"food items considered as goods"},{"testNo":1,"passageNo":1,"surface":"worldwide","partOfSpeech":"adverb","translationUz":"butun dunyo bo‘ylab","definitionEn":"across the world"},{"testNo":1,"passageNo":1,"surface":"covered container","partOfSpeech":"noun phrase","translationUz":"yopiq idish","definitionEn":"a vessel with a lid or cover"},{"testNo":1,"passageNo":1,"surface":"sterile jars","partOfSpeech":"noun phrase","translationUz":"steril bankalar","definitionEn":"glass containers free of microorganisms"}],"corrections":[],"offsetRepairs":[]}$plan$::jsonb;
  v_check record;
  v_repair record;
  v_item record;
  v_old record;
  v_passage_id uuid;
  v_body text;
  v_word text;
  v_part text;
  v_lexical_type text;
  v_unit_id uuid;
  v_lexeme_id uuid;
  v_sense_key text;
  v_regex text;
  v_start integer;
  v_total integer;
  v_ordinal integer;
  v_rows integer;
  v_repaired integer := 0;
  v_corrected integer := 0;
  v_inserted integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(11061401);

  -- Fail before any mutation if any source text or catalogue slot changed.
  FOR v_check IN SELECT key, value FROM jsonb_each_text(v_plan->'passages') LOOP
    SELECT COUNT(*), MIN(body_text) INTO v_total, v_body
      FROM reading_passages
      WHERE test_no=split_part(v_check.key,'-',1)::integer
        AND passage_no=split_part(v_check.key,'-',2)::integer;
    IF v_total <> 1 OR v_body IS NULL
       OR encode(extensions.digest(v_body,'sha256'),'hex') <> v_check.value THEN
      RAISE EXCEPTION 'Reading source checksum mismatch: %', v_check.key;
    END IF;
  END LOOP;

  -- Repair exact incorrect spans in passages 002 and 003 without changing IDs.
  FOR v_repair IN
    SELECT * FROM jsonb_to_recordset(v_plan->'offsetRepairs')
      AS r("testNo" integer,"passageNo" integer,id text,surface text,
           "expectedStart" integer,"matchOrdinal" integer)
  LOOP
    SELECT p.id,p.body_text,o.start_char,o.end_char,o.surface_form
      INTO v_old
      FROM lexical_occurrences o
      JOIN reading_passages p ON p.id=o.passage_id
      WHERE o.id=v_repair.id::uuid
        AND p.test_no=v_repair."testNo"
        AND p.passage_no=v_repair."passageNo";
    IF NOT FOUND OR lower(v_old.surface_form) <> lower(v_repair.surface) THEN
      RAISE EXCEPTION 'Reading repair target changed: %',v_repair.id;
    END IF;
    v_regex:='(?i)(?<![[:alpha:]])'||v_repair.surface||'(?![[:alpha:]])';
    v_start:=regexp_instr(v_old.body_text,v_regex,1,v_repair."matchOrdinal")-1;
    IF v_start<0 OR lower(substr(v_old.body_text,v_start+1,length(v_repair.surface)))
       <> lower(v_repair.surface) THEN
      RAISE EXCEPTION 'Reading repair missing or mismatched surface: %',v_repair.id;
    END IF;
    IF v_old.start_char=v_start AND v_old.end_char=v_start+length(v_repair.surface) THEN
      CONTINUE;
    END IF;
    IF v_old.start_char<>v_repair."expectedStart"
       OR EXISTS(SELECT 1 FROM lexical_occurrences o
         WHERE o.passage_id=v_old.id AND o.id<>v_repair.id::uuid
           AND o.start_char<v_start+length(v_repair.surface) AND o.end_char>v_start) THEN
      RAISE EXCEPTION 'Reading repair conflicts with prior span: %',v_repair.id;
    END IF;
    UPDATE lexical_occurrences o
      SET start_char=v_start,end_char=v_start+length(v_repair.surface),
        sentence_text=substr(v_old.body_text,greatest(1,v_start-120),260)
      WHERE o.id=v_repair.id::uuid;
    v_repaired:=v_repaired+1;
  END LOOP;

  -- Correct polysemous meanings in 001-003 and enrich 007-009.
  FOR v_item IN
    SELECT x.kind,x.test_no,x.passage_no,x.surface,x.pos,x.uz,x.definition
    FROM (
      SELECT 'correction'::text AS kind,c."testNo" AS test_no,
        c."passageNo" AS passage_no,c.surface,c."partOfSpeech" AS pos,
        c."translationUz" AS uz,c."definitionEn" AS definition
        FROM jsonb_to_recordset(v_plan->'corrections')
        AS c("testNo" integer,"passageNo" integer,surface text,
             "partOfSpeech" text,"translationUz" text,"definitionEn" text)
      UNION ALL
      SELECT 'new'::text AS kind,t."testNo" AS test_no,
        t."passageNo" AS passage_no,t.surface,t."partOfSpeech" AS pos,
        t."translationUz" AS uz,t."definitionEn" AS definition
        FROM jsonb_to_recordset(v_plan->'terms')
        AS t("testNo" integer,"passageNo" integer,surface text,
             "partOfSpeech" text,"translationUz" text,"definitionEn" text)
    ) AS x
    ORDER BY CASE WHEN x.kind='correction' THEN 0 ELSE 1 END,
      LENGTH(x.surface) DESC,x.test_no,x.passage_no,x.surface
  LOOP
    SELECT id,body_text INTO v_passage_id,v_body FROM reading_passages
      WHERE test_no=v_item.test_no AND passage_no=v_item.passage_no;
    IF v_passage_id IS NULL THEN
      RAISE EXCEPTION 'Reading passage missing: %-%',v_item.test_no,v_item.passage_no;
    END IF;
    v_word:=lower(trim(regexp_replace(v_item.surface,'[[:space:]]+',' ','g')));
    v_part:=lower(trim(v_item.pos));
    v_regex:='(?i)(?<![[:alpha:]])'||v_item.surface||'(?![[:alpha:]])';
    v_total:=regexp_count(v_body,v_regex);
    IF v_total<1 THEN
      RAISE EXCEPTION 'Reading vocabulary surface absent: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
    END IF;
    IF v_item.kind='correction' THEN
      SELECT COUNT(*) INTO v_rows FROM lexical_occurrences
        WHERE passage_id=v_passage_id AND lower(surface_form)=v_word;
      IF v_rows<1 THEN
        RAISE EXCEPTION 'Reading correction cardinality changed: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
      END IF;
    END IF;
    v_lexical_type:=CASE v_part
      WHEN 'noun phrase' THEN 'noun_phrase'
      WHEN 'verb phrase' THEN 'verb_phrase'
      WHEN 'phrasal verb' THEN 'phrasal_verb'
      WHEN 'idiom' THEN 'idiom'
      WHEN 'collocation' THEN 'collocation'
      WHEN 'fixed expression' THEN 'fixed_expression'
      WHEN 'compound' THEN 'compound'
      WHEN 'phrase' THEN 'phrase'
      ELSE CASE WHEN position(' ' IN v_word)>0 THEN 'phrase' ELSE 'word' END
    END;
    -- Reuse a lexical unit of the same lemma, POS and lexical type.
    INSERT INTO lexical_units
      (language,lemma,lemma_norm,part_of_speech,lexical_type,
       is_function_word,provenance)
      VALUES('en',v_item.surface,v_word,v_part,v_lexical_type,false,
             'reading_context')
      ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type) DO NOTHING;
    SELECT id INTO STRICT v_unit_id FROM lexical_units
      WHERE language='en' AND lemma_norm=v_word
        AND part_of_speech=v_part AND lexical_type=v_lexical_type;
    INSERT INTO lexical_unit_forms
      (lexical_unit_id,form,form_norm,form_type)
      VALUES(v_unit_id,v_item.surface,v_word,'lemma')
      ON CONFLICT(lexical_unit_id,form_norm) DO NOTHING;

    -- The v2 key is SHA256(JSON([normalised term, POS, English meaning])).
    v_sense_key:='v2:'||encode(extensions.digest(
      replace(json_build_array(v_word,v_part,lower(trim(v_item.definition)))::text,
              '", "', '","'),'sha256'),'hex');
    SELECT id INTO v_lexeme_id FROM lexemes
      WHERE sense_key=v_sense_key;
    IF v_lexeme_id IS NULL THEN
      -- Honor exact legacy senses too; do not duplicate identical meanings.
      SELECT id INTO v_lexeme_id FROM lexemes
        WHERE lower(trim(term))=v_word AND lower(trim(coalesce(part_of_speech,'')))=v_part
          AND lower(trim(definition_en))=lower(trim(v_item.definition))
        ORDER BY id LIMIT 1;
    END IF;
    IF v_lexeme_id IS NULL THEN
      INSERT INTO lexemes
        (term,part_of_speech,definition_en,translation_uz,example_sentence,
         lexical_unit_id,sense_key,provenance,verification_status,import_batch)
        VALUES(v_item.surface,v_item.pos,v_item.definition,v_item.uz,
               NULL,v_unit_id,v_sense_key,'reading_context',
               'context_checked','20261114-passage-001-context')
        ON CONFLICT(sense_key) DO NOTHING
        RETURNING id INTO v_lexeme_id;
      IF v_lexeme_id IS NULL THEN
        SELECT id INTO STRICT v_lexeme_id FROM lexemes WHERE sense_key=v_sense_key;
      END IF;
    END IF;
    SELECT coalesce(lexical_unit_id,v_unit_id) INTO v_unit_id
      FROM lexemes WHERE id=v_lexeme_id;

    IF v_item.kind='correction' THEN
      UPDATE lexical_occurrences
        SET lexeme_id=v_lexeme_id,lexical_unit_id=v_unit_id,
            resolution_status='resolved',resolution_source='context_editorial'
        WHERE passage_id=v_passage_id AND lower(surface_form)=v_word;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      v_corrected:=v_corrected+v_rows;
      CONTINUE;
    END IF;

    FOR v_ordinal IN 1..v_total LOOP
      v_start:=regexp_instr(v_body,v_regex,1,v_ordinal)-1;
      IF v_start<0 OR lower(substr(v_body,v_start+1,length(v_item.surface)))
        <> lower(v_item.surface) THEN
        RAISE EXCEPTION 'Source text shifted while linking: %-%, %',v_item.test_no,v_item.passage_no,v_item.surface;
      END IF;
      -- Keep pre-existing curated multiword senses authoritative.
      IF EXISTS(SELECT 1 FROM lexical_occurrences o
          WHERE o.passage_id=v_passage_id
            AND o.start_char<v_start+length(v_item.surface)
            AND o.end_char>v_start) THEN
        CONTINUE;
      END IF;
      INSERT INTO lexical_occurrences
        (source_type,passage_id,start_char,end_char,surface_form,lexeme_id,
         lexical_unit_id,resolution_status,resolution_source,sentence_text,
         occurrence_type,is_target_vocabulary)
        VALUES('reading',v_passage_id,v_start,v_start+length(v_item.surface),
               substr(v_body,v_start+1,length(v_item.surface)),
               v_lexeme_id,v_unit_id,'resolved','context_editorial',
               substr(v_body,greatest(1,v_start-120),260),
               'vocabulary',true)
        ON CONFLICT(passage_id,start_char,end_char) DO NOTHING;
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      v_inserted:=v_inserted+v_rows;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'reading contextual links: repaired %, corrected %, added %',
    v_repaired,v_corrected,v_inserted;
END
$executor$;
