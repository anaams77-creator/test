# Conversion report

| Source | Upstream pattern | Harbor implementation | Risk |
|---|---|---|---|
| Team X | Custom HTML | Direct HTML selectors | Medium |
| Azora | Iken JSON API | Direct API | Low/Medium |
| Manga Starz | Madara | Generic Madara adapter | Medium |
| Mangalek | Madara + mirrors + load more | Generic Madara + POST fallback | Medium/High |
| Mangalink AR | Madara + load more | Generic Madara + POST fallback | Medium/High |
| Manga Online | MMRCMS | HTML + JSON suggestions | Medium |
| ComicK Unoriginal | JSON API + embedded JSON scripts | API + raw HTML regex | High |
| ComicK Fanmade | HTML + chapter API | Direct adapter | Medium/High |
| LikeManga | Custom HTML/AJAX/base64 | Direct adapter | High |
| LinkManga EN | Madara | Generic Madara adapter | Medium |
| Manganato | MangaBox API + inline JS arrays | API + raw HTML regex | High |
| MangaPill | Custom HTML | Direct adapter | Medium |
| Webtoons | HTML + mobile API | Direct adapter | High because cookies are unavailable |

**معنى Risk:** احتمال الحاجة إلى تعديل بعد تجربة Harbor الحية، وليس حكمًا على الموقع نفسه.
