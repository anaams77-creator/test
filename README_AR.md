# Harbor Priority Manga Sources — حزمة اختبار v0.2.0

هذه الحزمة تعيد كتابة المصادر المهمة الظاهرة في الصور إلى واجهة إضافات **Harbor**.
لا تستخدم ملفات APK أو Kotlin وقت التشغيل؛ كل مصدر ملف JavaScript مستقل يعمل عبر `harbor.http` و`harbor.parseHtml`.

## المصادر المضمّنة

### العربية
- Team X
- Azora
- Manga Starz
- مانجا ليك
- مانجا لينك
- مانجا اون لاين

### الإنجليزية
- ComicK (Unoriginal)
- ComicK Fanmade
- LikeManga
- LinkManga
- Manganato
- MangaPill
- Webtoons.com

تم استبعاد MangaDex بناءً على طلب المستخدم.

## رفع الحزمة إلى GitHub

1. أنشئ مستودع GitHub جديدًا.
2. ارفع `repo.json` ومجلد `plugins` مع الحفاظ على نفس المسارات.
3. افتح `repo.json` في GitHub واضغط **Raw**.
4. انسخ رابط Raw وأضفه داخل Harbor: `Manga sources > Extensions > Add a repository`.
5. ثبّت مصدرًا واحدًا في كل مرة واختبر: Browse → Search → Details → Chapters → Reader.

صيغة رابط Raw المتوقعة:

```text
https://raw.githubusercontent.com/USERNAME/REPOSITORY/main/repo.json
```

## ترتيب الاختبار المقترح

ابدأ بهذه المصادر لأنها أبسط بنيويًا:

1. Team X
2. Azora
3. MangaPill
4. مانجا اون لاين
5. Manga Starz / مانجا ليك / مانجا لينك / LinkManga
6. LikeManga
7. Manganato
8. ComicK Fanmade
9. ComicK (Unoriginal)
10. Webtoons.com

## قيود Harbor المؤثرة

- Harbor يمنع `fetch` والـDOM العادي والكوكيز، كما يزيل `Referer` و`Origin` من الطلبات.
- لذلك قد تعمل القوائم والتفاصيل في مصدر بينما تمنع خوادم الصور القراءة.
- المواقع التي تستخدم Cloudflare أو تغير HTML/API قد تحتاج تحديث selectors أو domain.
- جلب الفصول متعدد الصفحات محدود عمدًا لتجنب مهلة Harbor وحد 6 طلبات متزامنة.

## التحقق المحلي

يتضمن المجلد `tools/validate.js`. شغّل:

```bash
node tools/validate.js
```

هذا يفحص JSON، وصحة JavaScript، وتسجيل كل Provider ووجود الدوال الخمس المطلوبة. لا يحل محل الاختبار الحي داخل Harbor.
