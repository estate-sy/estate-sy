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

const SITE_URL        = 'https://estate-sy.netlify.app';
const FALLBACK_IMAGE  = `${SITE_URL}/img/fallback.png`; // ⚠️ تأكد من رفع صورة بمقاس 1200×630 بهذا الاسم في مجلد img/

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

/** يركّب العنوان من property_type + " في " + city + " - " + area_name (وفق أعمدة الجدول بالضبط) */
function buildTitle(property) {
    let title = `${property.property_type} في ${property.city}`;
    if (property.area_name) title += ` - ${property.area_name}`;
    return title;
}

/** يركّب الوصف من description + السعر + العملة */
function buildDescription(property) {
    const priceText = `${Number(property.price).toLocaleString()} ${property.currency || ''}`.trim();
    const base = property.description ? property.description.trim() : '';
    const full = base ? `${base} — السعر: ${priceText}` : `السعر: ${priceText}`;
    return full.length > 200 ? full.slice(0, 197) + '...' : full;
}

/** يأخذ أول رابط من مصفوفة images (JSON array)، وإلا يرجع صورة الاحتياط */
function buildImage(property) {
    if (Array.isArray(property.images) && property.images.length > 0 && property.images[0]) {
        return property.images[0];
    }
    return FALLBACK_IMAGE;
}

exports.handler = async (event) => {
    const id = event.queryStringParameters?.id;

    if (!id) {
        return { statusCode: 400, body: 'Missing property id' };
    }

    // رابط الصفحة الحقيقية التي يُحوَّل إليها الزائر البشري
    const realUrl = `${SITE_URL}/details.html?id=${id}`;

    let property = null;
    try {
        property = await fetchProperty(id);
    } catch (err) {
        console.error('❌ property-og: fetch failed:', err.message);
        property = null;
    }

    // فشل الجلب أو العقار غير موجود (حُذف مثلاً) — بطاقة احتياطية عامة + تحويل فوري
    if (!property) {
        const fallbackHtml = buildHtml({
            title: 'العقارات السورية',
            description: 'منصة العقارات السورية - بيع وإيجار الشقق والأراضي والمحلات في سوريا',
            image: FALLBACK_IMAGE,
            url: realUrl
        });
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: fallbackHtml
        };
    }

    const html = buildHtml({
        title: buildTitle(property),
        description: buildDescription(property),
        image: buildImage(property),
        url: realUrl
    });

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: html
    };
};

function buildHtml({ title, description, image, url }) {
    return `<!DOCTYPE html>
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
    <meta property="og:url" content="${escapeHtml(url)}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">

    <!-- تحويل فوري للزائر البشري (المتصفحات الحقيقية) نحو الصفحة الفعلية -->
    <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">
    <link rel="canonical" href="${escapeHtml(url)}">
    <script>window.location.replace(${JSON.stringify(url)});</script>
</head>
<body>
    <p>جاري تحويلك... <a href="${escapeHtml(url)}">اضغط هنا إن لم يتم التحويل تلقائياً</a></p>
</body>
</html>`;
}
