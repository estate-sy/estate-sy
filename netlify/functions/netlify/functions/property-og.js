// ══════════════════════════════════════════════════════════════════
// netlify/functions/property-og.js
// دالة خادمية (Netlify Function) تُنشئ صفحة HTML صغيرة تحتوي وسوم
// Open Graph الصحيحة لكل عقار، مبنية من بيانات Supabase وقت الطلب.
//
// لماذا هذا ضروري: واتساب/تيليجرام/فيسبوك تقرأ الصفحة عبر "Bot" لا يُشغّل
// جافاسكريبت إطلاقاً — فهي تقرأ الـ <head> كما وصل من الخادم فقط.
// تحديث الوسوم عبر document.head بعد جلب البيانات في المتصفح (Client-side)
// لا يُغيّر شيئاً بالنسبة لهذه الروبوتات، لأنها لا تنتظر تنفيذ أي سكربت.
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL      = 'https://pgmpyzmaadmixzwdcfdd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4OClIc8ci2545V8pzyr4RA_4X26Li0x';

const PROPERTY_TYPE_LABELS = { apartment: 'شقة', villa: 'فيلا', land: 'أرض', shop: 'محل تجاري', office: 'مكتب' };

const SITE_URL   = 'https://estate-sy.netlify.app';
const FALLBACK_IMAGE = `${SITE_URL}/img/fallback.png`; // ⚠️ تأكد من رفع صورة بمقاس 1200×630 بهذا الاسم في مجلد img/

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function fetchProperty(id) {
    const url = `${SUPABASE_URL}/rest/v1/properties?id=eq.${id}&select=*`;
    const res = await fetch(url, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
}

exports.handler = async (event) => {
    const id = event.queryStringParameters?.id;

    if (!id) {
        return { statusCode: 400, body: 'Missing property id' };
    }

    const property = await fetchProperty(id);

    // رابط الصفحة الحقيقية التي يُحوَّل إليها الزائر البشري
    const realUrl = `${SITE_URL}/details.html?id=${id}`;

    if (!property) {
        // عقار غير موجود (حُذف مثلاً) — نحوّل مباشرة دون بطاقة معاينة خاصة
        return {
            statusCode: 302,
            headers: { Location: realUrl }
        };
    }

    const typeLabel = PROPERTY_TYPE_LABELS[property.property_type] || property.property_type;

    // العنوان: property_type + " في " + city + " - " + area_name
    const title = `${typeLabel} في ${property.city} - ${property.area_name || ''}`.trim();

    // السعر مُنسّق مع العملة (price + currency)
    const priceText = property.price
        ? `${Number(property.price).toLocaleString()} ${property.currency || ''}`.trim()
        : '';

    // الوصف: description + السعر
    const baseDescription = property.description || `${typeLabel} في ${property.city}`;
    const rawDescription = priceText ? `${baseDescription} - السعر: ${priceText}` : baseDescription;
    const description = rawDescription.length > 160 ? rawDescription.slice(0, 157) + '...' : rawDescription;

    // الصورة: أول رابط من مصفوفة images وإلا صورة fallback
    const image = (Array.isArray(property.images) && property.images.length > 0)
        ? property.images[0]
        : FALLBACK_IMAGE;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>

    <meta property="og:type" content="website">
    <meta property="og:site_name" content="العقارات السورية">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="${escapeHtml(realUrl)}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">

    <!-- تحويل فوري للزائر البشري (المتصفحات الحقيقية) نحو الصفحة الفعلية -->
    <meta http-equiv="refresh" content="0; url=${escapeHtml(realUrl)}">
    <link rel="canonical" href="${escapeHtml(realUrl)}">
    <script>window.location.replace(${JSON.stringify(realUrl)});</script>
</head>
<body>
    <p>جاري تحويلك... <a href="${escapeHtml(realUrl)}">اضغط هنا إن لم يتم التحويل تلقائياً</a></p>
</body>
</html>`;

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: html
    };
};
