# WanderWood
אתר למכירת אביזרי צילום מעץ בהתאמה אישית.

## סנכרון מוצרים מגיליון Google Sheets

נוסף Workflow בשם `Sync products from Google Sheets` שמופעל ב־2 דרכים:

1. ידנית מתוך לשונית Actions (`workflow_dispatch`).
2. דרך Webhook פנימי של GitHub (`repository_dispatch` עם type: `products_sync`).

ה־Workflow טוען TSV מהשיטס, מייצר `products.json` חדש במאגר, ומבצע commit + push רק אם יש שינוי.

## קישורים להגדרה ולהפעלה מדף הניהול

החליפי את `<OWNER>` ו-`<REPO>`:

- דף Actions: `https://github.com/<OWNER>/<REPO>/actions`
- ה-Workflow הספציפי: `https://github.com/<OWNER>/<REPO>/actions/workflows/sync-products.yml`
- יצירת Personal Access Token (Classic): `https://github.com/settings/tokens/new`
- ניהול Webhooks במערכת הניהול שלך (URL שצריך להגדיר):
  - Endpoint: `https://api.github.com/repos/<OWNER>/<REPO>/dispatches`
  - Method: `POST`
  - Headers:
    - `Accept: application/vnd.github+json`
    - `Authorization: Bearer <GITHUB_TOKEN>`
    - `X-GitHub-Api-Version: 2022-11-28`
  - Body:

```json
{
  "event_type": "products_sync",
  "client_payload": {
    "source": "admin-products"
  }
}
```

מומלץ לקרוא ל־Webhook הזה אחרי כל הוספה / עריכה / מחיקה של מוצר בדף הניהול.
