# R07 — joriy kodning mahalliy fizik PITR sinovi

Holat: LOCAL_REHEARSAL_PASSED_NOT_PROVIDER_ACCEPTANCE.
Kanonik source: `1a6f751f17f59caf54074c7ba9932b7e1a2893157ec3b4170a495626d2dc01ac`,1256fayl. Asosiy kod o‘zgartirilmadi;1491backend/265UI bo‘yicha oldingi ikkita to‘liq native bosqich joriy manbaga tegishli bo‘lib qoladi.

Ikkita yangi `/tmp/riwi-r07-pitr-*` shaxsiy cluster yaratildi. Mavjud trusted PostgreSQL16.14 server va Node `pg` bilan rasmiy `pg_backup_start` / `pg_backup_stop` API ishlatildi. Start/Stop bitta ulanishda; fysisk fayllar nusxalandi, `backup_label` o‘zgartirilmay saqlandi, WAL archiving tugashi kutildi. `pg_dump` ishlatilmadi. WAL uchun faqat shu clusterga tegishli papka, fsync va boshqacha mavjud baytlarni ustiga yozishni rad etish qo‘llandi. External tablespace yo‘q.

Rasmiy metod manbasi: https://www.postgresql.org/docs/16/continuous-archiving.html#BACKUP-LOWLEVEL-BASE-BACKUP . Bu metod mazkur disposable sinov uchun; ishlab turgan bazani shu skriptga target qilib bermang.

115 jadvalning tiklashdan oldingi va keyingi SHA256 fingerprintlari teng;181foreign key ta’rifi teng,unvalidated constraint0. Targetdan oldin commit qilingan5canary qaytdi, undan keyin commit qilingan3canary qaytmadi. Raw PostgreSQL jurnali WALni arxivdan o‘qish, belgilangan vaqtdan keyingi commitdan oldin to‘xtash va yangi2-timeline’ga promotionni ko‘rsatadi. Ikki yo‘nalish fingerprintlari `integrity.json` da alohida saqlangan. Sequence qiymatlari alohida tenglashtirilmadi va ushbu packet ularni provider acceptance deb bermaydi.

Haqiqiy Next dev app tiklangan DB bilan ochildi: synthetic owner login200, owner knowledge200 va kutilgan synthetic canary topildi; anonymous knowledge401 va canary berilmadi. API javobining body hashi saqlangan, parol/cookie saqlanmagan. Production build, real provider/storage, production/sharedDB ishlatilmadi. App va ikkala cluster yopildi; vaqtinchalik parol fayli yo‘q.

Mahalliy observedRPO 10.525923s: simulated failure bilan eng oxirgi qaytgan client acknowledgement orasidagi farq. Bu ataylab eski target tanlangan kichik synthetic sinovdir, hosting xizmatining RPO kafolati emas. Requestdan app+integrity tekshiruvi yakunigacha mahalliyRTO 20.374138s; DB ready uchun 0.896301s. Bu ko‘rsatkichlarni Railway yoki ishlab turgan dataset uchun ko‘chirmang.

Dalillar: `docs/evidence/riwi-groups-20-25-review/r07-native-physical-pitr/`. `verification.json` kanonik1256fayl,9rawgate,4QAtoolhash,2tomonlama115table/FK,backup_label/WALbaytlari,owner/anonymous natija va shutdownni mustaqil tekshiradi. WAL/fizik DB katta va shaxsiy sinov fayllari; ZIPga raw data directory kiritilmagan. Portable packetdagi loglar/hashlarni verifier o‘qiydi; optional `--private-root` bilan shu Macdagi physical bytes ham qayta tekshiriladi.

Komandalar (repo ichidan, asl1256source/dependency saqlanganda):

```sh
python3 docs/qa/RIWI_R07_NATIVE_LOW_LEVEL_PITR.py --repo . --pg-bin ../../native-postgres16/package/native/bin --source-manifest docs/qa/RIWI_GROUPS20_25_SOURCE_STATE.json
python3 docs/qa/RIWI_R07_VERIFY_LOW_LEVEL_PITR.py --repo . --evidence docs/evidence/riwi-groups-20-25-review/r07-native-physical-pitr
```

Mac shell sandbox native IPC’ni rad etsa, ruxsatli host runtime orqali ayni trusted binaries va shu disposable runner bilan bajarilgan dalil saqlanadi; ishlab turgan bazani fallback qilib tanlamang. Eski `RIWI_R07_NATIVE_PITR_REHEARSAL.py` psql/pg_basebackup’ni talab qiladigan tarixiy variant, uning o‘zi o‘tgan deb yozilmadi. Dastlab literal/tmp–private/tmp guard mosligi xatosi bo‘lgan urinish FAILED holatda, bazasi yopilgan dalil bilan saqlanadi. Birinchi successful run va yakuniy yanada to‘liq integrity dalilli run alohida saqlangan.

R07 hali PARTIAL: actual authorised hosting-provider backup/restore, policy/retention/latest-restorable-point va owner tanlagan contractualRPO/RTO qabul dalili qolgan. Groupclosurecredit0;20/34=58.823529%, RIWIoverall/siteoverall denominatorlar noma’lum.
