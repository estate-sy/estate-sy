// ══════════════════════════════════════════════════════════════════
// app.js — العقارات السورية
// الملف المركزي: تهيئة Supabase + كل الدوال المشتركة (Modular)
// يُستدعى في كل صفحة عبر: <script type="module" src="app.js"></script>
// ══════════════════════════════════════════════════════════════════

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ──────────────────────────────────────────────────────────────────
// ⚙️ 1) إعدادات المشروع — استبدل بمفاتيح مشروع Supabase الجديد
// ──────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://pgmpyzmaadmixzwdcfdd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4OClIc8ci2545V8pzyr4RA_4X26Li0x';

const PROPERTY_BUCKET = 'property-images';
const AVATAR_BUCKET   = 'avatars';

function initSupabaseClient() {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase client initialized (app.js)');
    return client;
}
const supabase = initSupabaseClient();

// ──────────────────────────────────────────────────────────────────
// 2) ثوابت مشتركة (تسميات عربية للقيم المخزنة بالإنجليزية)
// ──────────────────────────────────────────────────────────────────
const PROPERTY_TYPE_LABELS = { apartment: 'شقة', villa: 'فيلا', land: 'أرض', shop: 'محل تجاري', office: 'مكتب' };
const OWNERSHIP_LABELS     = { green_tabu: 'طابو أخضر', temp_tabu: 'طابو مؤقت', notarized: 'محكمة (كاتب عدل)', power_of_attorney: 'وكالة', other: 'أخرى' };
const DEAL_LABELS          = { sale: 'للبيع', rent: 'للإيجار' };
const VERIFICATION_MIN_FOLLOWERS = 100;
const CITIES_LIST = [
    "دمشق", "ريف دمشق", "حلب", "حمص", "حماة",
    "اللاذقية", "طرطوس", "إدلب", "درعا", "السويداء",
    "القنيطرة", "دير الزور", "الرقة", "الحسكة"
];

// ══════════════════════════════════════════════════════════════════
// 3) وحدة المصادقة (Auth)
// ══════════════════════════════════════════════════════════════════
const Auth = {

    /** إرجاع الجلسة الحالية (أو null) */
    async getSession() {
        const { data } = await supabase.auth.getSession();
        return data?.session || null;
    },

    /** إرجاع المستخدم الحالي (أو null) */
    async getCurrentUser() {
        const session = await this.getSession();
        return session?.user || null;
    },

    /** التحقق الإلزامي من الهوية — يحوّل لصفحة login.html إن لم يكن هناك جلسة */
    async requireAuth() {
        let session = await this.getSession();
        if (!session) {
            await new Promise(r => setTimeout(r, 2000));
            session = await this.getSession();
        }
        if (!session) {
            window.location.href = 'login.html';
            return null;
        }
        return session.user;
    },

    /** إعادة توجيه المستخدم المسجّل دخوله بالفعل بعيداً عن صفحة login */
    async redirectIfLoggedIn(target = 'profile.html') {
        const session = await this.getSession();
        if (session) window.location.href = target;
    },

    /** تسجيل الدخول عبر Google OAuth */
    async loginWithGoogle(redirectPage = 'profile.html') {
        const redirectUrl = window.location.origin
            + window.location.pathname.replace(/[^/]*$/, '')
            + redirectPage;

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options:  { redirectTo: redirectUrl }
        });
        return { error };
    },

    /** تسجيل الخروج */
    async logout() {
        await supabase.auth.signOut();
        window.location.replace('login.html');
    },

    /** تغيير كلمة المرور */
    async changePassword(newPassword) {
        return await supabase.auth.updateUser({ password: newPassword });
    },

    /** الاستماع لأي تغيّر في حالة المصادقة */
    onAuthStateChange(callback) {
        supabase.auth.onAuthStateChange(callback);
    }
};

// ══════════════════════════════════════════════════════════════════
// 4) وحدة تخزين الصور (Storage) — رفع + ضغط تكيّفي
// ══════════════════════════════════════════════════════════════════
const Storage = {

    /**
     * ضغط صورة عبر Canvas API — ضغط تكيّفي يضمن الوصول لحجم هدف
     * الخوارزمية: تصغير الأبعاد ثم خفض الجودة تدريجياً حتى الوصول للهدف
     */
    async compressImage(file, targetKB = 200, maxWidth = 1280) {
        return new Promise((resolve) => {
            if (file.size <= targetKB * 1024) { resolve(file); return; }

            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);
                let { width, height } = img;
                if (width > maxWidth) {
                    height = Math.round(height * maxWidth / width);
                    width  = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const TARGET_BYTES = targetKB * 1024;
                let   quality      = 0.85;
                const MIN_QUALITY  = 0.30;
                const STEP         = 0.07;

                function tryCompress() {
                    canvas.toBlob((blob) => {
                        if (!blob) { resolve(file); return; }
                        const isUnderTarget     = blob.size <= TARGET_BYTES;
                        const reachedMinQuality = quality <= MIN_QUALITY;
                        if (isUnderTarget || reachedMinQuality) {
                            const compressed = new File(
                                [blob],
                                file.name.replace(/\.[^.]+$/, '') + '.jpg',
                                { type: 'image/jpeg', lastModified: Date.now() }
                            );
                            resolve(compressed);
                        } else {
                            quality = Math.max(quality - STEP, MIN_QUALITY);
                            tryCompress();
                        }
                    }, 'image/jpeg', quality);
                }
                tryCompress();
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    },

    /** ضغط مجموعة صور تسلسلياً مع تحديث دالة تقدّم اختيارية (onProgress) */
    async compressImages(files, onProgress = null) {
        const compressed = [];
        for (let i = 0; i < files.length; i++) {
            if (onProgress) onProgress(i + 1, files.length);
            compressed.push(await this.compressImage(files[i]));
        }
        return compressed;
    },

    /** رفع مجموعة صور إلى bucket العقارات، وإرجاع روابطها العامة */
    async uploadPropertyImages(files, ownerId, onProgress = null) {
        return this._uploadToBucket(files, PROPERTY_BUCKET, `properties/${ownerId}`, onProgress);
    },

    /** رفع صورة شخصية واحدة (Avatar) — upsert دائماً */
    async uploadAvatar(file, userId) {
        const ext  = file.name.split('.').pop();
        const path = `${userId}/avatar.${ext}`;
        const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
        return data.publicUrl + '?v=' + Date.now();
    },

    /** دالة داخلية عامة للرفع لأي bucket */
    async _uploadToBucket(files, bucket, folderPrefix, onProgress = null) {
        const uploadedUrls = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > 5 * 1024 * 1024) throw new Error(`الصورة ${i + 1} كبيرة جداً (حد أقصى 5MB)`);

            const timestamp = Date.now();
            const randomStr = Math.random().toString(36).substring(2, 8);
            const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const filePath  = `${folderPrefix}/${timestamp}_${randomStr}_${i}.${extension}`;

            if (onProgress) onProgress(i + 1, files.length, file);

            const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
                cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg'
            });
            if (error) throw new Error(`فشل رفع الصورة ${i + 1}: ${error.message}`);

            const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
            uploadedUrls.push(data.publicUrl);
        }
        return uploadedUrls;
    }
};

// ══════════════════════════════════════════════════════════════════
// 5) وحدة قاعدة البيانات (Database) — Properties / Favorites / Profiles / Ratings / Notifications
// ══════════════════════════════════════════════════════════════════
const DB = {

    // ── العقارات ──
    async fetchProperties({ status = 'active', limit = 200 } = {}) {
        const { data, error } = await supabase
            .from('properties')
            .select('*, owner:profiles!properties_owner_id_fkey(name, phone, avatar_url)')
            .eq('status', status)
            .order('created_at', { ascending: false })
            .range(0, limit - 1);

        if (error) {
            console.warn('⚠️ join query failed, falling back:', error.message);
            const { data: fallback, error: err2 } = await supabase
                .from('properties').select('*').eq('status', status)
                .order('created_at', { ascending: false }).range(0, limit - 1);
            if (err2) {
                console.error('❌ Fallback failed:', err2.message);
                UI.showError('تعذّر جلب العقارات، تحقق من اتصالك بالإنترنت');
                return [];
            }
            return fallback;
        }
        return data;
    },

    async fetchPropertyById(id) {
        const { data, error } = await supabase.from('properties').select('*').eq('id', id).single();
        if (error) {
            console.error('❌ fetchPropertyById:', error.message);
            UI.showError('تعذّر جلب بيانات هذا العقار');
            return null;
        }
        return data;
    },

    async fetchPropertiesByOwner(ownerId) {
        const { data, error } = await supabase.from('properties').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false });
        if (error) {
            console.error('❌ fetchPropertiesByOwner:', error.message);
            UI.showError('تعذّر جلب إعلاناتك');
            return [];
        }
        return data;
    },

    async insertProperty(payload) {
        const { data, error } = await supabase.from('properties').insert(payload).select().single();
        if (error) throw error;
        return data;
    },

    async updateProperty(id, updates) {
        const { error } = await supabase.from('properties').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        return true;
    },

    async deleteProperty(id) {
        const { error } = await supabase.from('properties').delete().eq('id', id);
        if (error) throw error;
        return true;
    },

    async incrementViews(id, currentViews) {
        const { error } = await supabase.from('properties').update({ views: (currentViews || 0) + 1 }).eq('id', id);
        if (error) console.warn('⚠️ incrementViews failed:', error.message);
    },

    // ── المفضلة ──
    async isFavorited(userId, propertyId) {
        if (!userId) return false;
        const { data } = await supabase.from('favorites').select('id').eq('user_id', userId).eq('property_id', propertyId).maybeSingle();
        return !!data;
    },

    async addFavorite(userId, propertyId) {
        return await supabase.from('favorites').insert({ user_id: userId, property_id: propertyId });
    },

    async removeFavorite(userId, propertyId) {
        return await supabase.from('favorites').delete().eq('user_id', userId).eq('property_id', propertyId);
    },

    async fetchFavoritesWithProperties(userId) {
        const { data, error } = await supabase.from('favorites').select('*, properties(*)').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) {
            console.error('❌ fetchFavorites:', error.message);
            UI.showError('تعذّر جلب قائمة المفضلة');
            return [];
        }
        return data.filter(f => f.properties);
    },

    // ── الملفات الشخصية ──
    async fetchProfile(userId) {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        return data;
    },

    async ensureProfile(user) {
        const existing = await this.fetchProfile(user.id);
        if (existing) {
            const googleName   = user.user_metadata?.full_name || user.user_metadata?.name;
            const googleAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
            const needsSync = (googleName && googleName !== existing.name) || (googleAvatar && googleAvatar !== existing.avatar_url);
            if (needsSync) {
                const syncPayload = {};
                if (googleName) syncPayload.name = googleName;
                if (googleAvatar) syncPayload.avatar_url = googleAvatar;
                supabase.from('profiles').update(syncPayload).eq('id', user.id).then(() => {});
                Object.assign(existing, syncPayload);
            }
            return existing;
        }
        const defaults = {
            id: user.id,
            name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            phone: user.phone || '',
            avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            followers_count: 0
        };
        const { data } = await supabase.from('profiles').upsert(defaults).select().single();
        return data || defaults;
    },

    async updateProfile(userId, updates) {
        const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
        if (error) throw error;
        return true;
    },

    /** التحقق إن كان @handle متاحاً (غير مستخدم من مستخدم آخر) */
    async isHandleAvailable(handle, excludeUserId) {
        if (!handle) return false;
        const clean = handle.trim().toLowerCase();
        const { data } = await supabase.from('profiles').select('id').ilike('handle', clean).maybeSingle();
        if (!data) return true;
        return data.id === excludeUserId;
    },

    // ── متابعة البائعين ──
    async isFollowing(followerId, followedId) {
        if (!followerId || !followedId) return false;
        const { data } = await supabase.from('follows').select('id')
            .eq('follower_id', followerId).eq('followed_id', followedId).maybeSingle();
        return !!data;
    },

    async followUser(followerId, followedId) {
        return await supabase.from('follows').insert({ follower_id: followerId, followed_id: followedId });
    },

    async unfollowUser(followerId, followedId) {
        return await supabase.from('follows').delete()
            .eq('follower_id', followerId).eq('followed_id', followedId);
    },

    // ── التقييمات ──
    async fetchSellerRatings(sellerId) {
        const { data, error } = await supabase.from('seller_ratings').select('stars').eq('seller_id', sellerId);
        if (error) { console.warn('⚠️ fetchSellerRatings:', error.message); return []; }
        return data || [];
    },

    async submitRating(sellerId, raterId, stars) {
        return await supabase.from('seller_ratings').upsert(
            { seller_id: sellerId, rater_id: raterId, stars },
            { onConflict: 'seller_id,rater_id' }
        );
    },

    // ── الإشعارات ──
    async sendNotification({ userId, actorId, actorName, type, message, propertyId }) {
        try {
            await supabase.from('notifications').insert({
                user_id: userId, actor_id: actorId, actor_name: actorName,
                type, message, property_id: propertyId, is_read: false
            });
        } catch (e) { console.warn('⚠️ sendNotification failed:', e.message); }
    },

    // ── توثيق الحساب (العلامة الزرقاء) ──
    /** تحقق من الأهلية في الواجهة قبل حتى محاولة الإرسال (تجربة مستخدم أفضل من انتظار خطأ من القاعدة) */
    isEligibleForVerification(followersCount) {
        return (followersCount || 0) >= VERIFICATION_MIN_FOLLOWERS;
    },

    async requestVerification(userId, reason = '') {
        const { error } = await supabase.from('verification_requests').insert({ user_id: userId, reason, status: 'pending' });
        if (error) throw error;
        await supabase.from('profiles').update({ verification_requested_at: new Date().toISOString() }).eq('id', userId);
        return true;
    },

    async fetchVerificationStatus(userId) {
        const { data } = await supabase.from('verification_requests')
            .select('*').eq('user_id', userId)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
        return data || null;
    }
};

// ══════════════════════════════════════════════════════════════════
// 6) وحدة واجهة المستخدم (UI helpers) — Toast / timeAgo
// ══════════════════════════════════════════════════════════════════
const UI = {
    showToast(msg) {
        let t = document.getElementById('se-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'se-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
    },

    /** إشعار خطأ موحّد — يُستخدم بدل الاكتفاء بـ console.error عند فشل عمليات Supabase */
    showError(msg = 'حدث خطأ أثناء الاتصال بالخادم، حاول مجدداً') {
        this.showToast('⚠️ ' + msg);
    },

    /**
     * تنقية أي نص قادم من المستخدم (وصف عقار، نبذة، اسم منطقة...) قبل إدراجه
     * ضمن innerHTML، لمنع ثغرات XSS التخزينية (Stored XSS). يحوّل الأحرف
     * الخاصة في HTML إلى كياناتها النصية، ثم يحوّل الأسطر الجديدة إلى <br>.
     */
    escapeHtml(str = '') {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    },

    escapeHtmlMultiline(str = '') {
        return this.escapeHtml(str).replace(/\n/g, '<br>');
    },

    /**
     * Debounce عام — يؤخر تنفيذ الدالة حتى يتوقف المستخدم عن الكتابة/التفاعل
     * لمدة delay مللي ثانية. يُستخدم في حقول البحث والفلاتر لتقليل عدد
     * العمليات المتكررة (حماية بسيطة من إساءة الاستخدام + أداء أفضل).
     */
    debounce(fn, delay = 350) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    timeAgo(dateStr) {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 3600) return `منذ ${Math.max(1, Math.floor(diff / 60))} د`;
        if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
        return `منذ ${Math.floor(diff / 86400)} يوم`;
    },

    async loadNavAvatar(imgId = 'profileNavAvatar', iconId = 'profileNavIcon') {
        const user = await Auth.getCurrentUser();
        if (!user) return;
        const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
        if (!avatarUrl) return;
        const img  = document.getElementById(imgId);
        const icon = document.getElementById(iconId);
        if (!img || !icon) return;
        img.src = avatarUrl;
        img.classList.remove('hidden');
        icon.classList.add('hidden');
    }
};

// ══════════════════════════════════════════════════════════════════
// 7) وحدة الترجمة (i18n) — عربي / إنجليزي
// ══════════════════════════════════════════════════════════════════
const DICT = {
    ar: {
        appName: 'العقارات السورية', appNameEn: 'Syria Estate',
        forSale: 'للبيع', forRent: 'للإيجار', land: 'أراضي',
        addProperty: '+ أضف عقار', search: 'ابحث عن حي، مدينة، أو نوع عقار...',
        allTypes: 'نوع العقار', allCities: 'كل المحافظات', showMap: 'عرض الخريطة',
        myAds: 'إعلاناتي', favorites: 'المفضلة', myProfile: 'الملف الشخصي', stats: 'الإحصائيات',
        logout: 'تسجيل الخروج', save: 'حفظ التعديلات', changePassword: 'تغيير كلمة المرور',
        shareProfile: 'مشاركة ملفي الشخصي', requestVerify: 'طلب توثيق الحساب',
        privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام', contactDev: 'تواصل مع المطورين',
        lightMode: 'الوضع النهاري', darkMode: 'الوضع الليلي', language: 'اللغة',
        type_apartment: 'شقة', type_villa: 'فيلا', type_land: 'أرض', type_shop: 'محل تجاري', type_office: 'مكتب',
        deal_sale: 'للبيع', deal_rent: 'للإيجار'
    },
    en: {
        appName: 'Syria Estate', appNameEn: 'Syria Estate',
        forSale: 'For Sale', forRent: 'For Rent', land: 'Land',
        addProperty: '+ Add Property', search: 'Search by area, city, or property type...',
        allTypes: 'Property Type', allCities: 'All Cities', showMap: 'Show Map',
        myAds: 'My Ads', favorites: 'Favorites', myProfile: 'My Profile', stats: 'Statistics',
        logout: 'Logout', save: 'Save Changes', changePassword: 'Change Password',
        shareProfile: 'Share My Profile', requestVerify: 'Request Verification',
        privacy: 'Privacy Policy', terms: 'Terms of Use', contactDev: 'Contact Developers',
        lightMode: 'Light Mode', darkMode: 'Dark Mode', language: 'Language',
        type_apartment: 'Apartment', type_villa: 'Villa', type_land: 'Land', type_shop: 'Shop', type_office: 'Office',
        deal_sale: 'For Sale', deal_rent: 'For Rent'
    }
};

const I18n = {
    STORAGE_KEY: 'se_lang',

    getLang() {
        return localStorage.getItem(this.STORAGE_KEY) || 'ar';
    },

    setLang(lang) {
        if (lang !== 'ar' && lang !== 'en') lang = 'ar';
        localStorage.setItem(this.STORAGE_KEY, lang);
        document.documentElement.lang = lang;
        document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
        this.apply();
        // نبثّ حدثاً عاماً كي تُعيد كل صفحة رسم محتواها الديناميكي (بطاقات، تبويبات...)
        window.dispatchEvent(new CustomEvent('se:langchange', { detail: { lang } }));
    },

    t(key) {
        const lang = this.getLang();
        return DICT[lang]?.[key] ?? DICT.ar[key] ?? key;
    },

    /** ترجمة نوع العقار (apartment/villa/land/shop/office) حسب اللغة الحالية */
    typeLabel(propertyType) {
        return this.t('type_' + propertyType) || propertyType;
    },

    /** ترجمة نوع الصفقة (sale/rent) حسب اللغة الحالية */
    dealLabel(dealType) {
        return this.t('deal_' + dealType) || dealType;
    },

    /** يستبدل نص كل عنصر يحمل data-i18n="key" بالترجمة المناسبة */
    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.setAttribute('placeholder', this.t(key));
        });
    },

    /** تهيئة أولية عند تحميل الصفحة: تطبيق اللغة المحفوظة */
    init() {
        const lang = this.getLang();
        document.documentElement.lang = lang;
        document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
        this.apply();
    },

    toggle() {
        const next = this.getLang() === 'ar' ? 'en' : 'ar';
        this.setLang(next);
        if (window.SEApp?.UI) window.SEApp.UI.showToast(next === 'ar' ? '✅ تم التبديل إلى العربية' : '✅ Switched to English');
    }
};

// ══════════════════════════════════════════════════════════════════
// 8) وحدة السمة (Theme) — Dark / Light Mode
// ══════════════════════════════════════════════════════════════════
const Theme = {
    STORAGE_KEY: 'se_theme',

    getTheme() {
        return localStorage.getItem(this.STORAGE_KEY) || 'light';
    },

    setTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
        document.documentElement.setAttribute('data-theme', theme);
    },

    init() {
        this.setTheme(this.getTheme());
    },

    toggle() {
        this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark');
    }
};

// ══════════════════════════════════════════════════════════════════
// 9.5) وحدة PWA — التقاط حدث beforeinstallprompt + بانر تثبيت تلقائي
// ══════════════════════════════════════════════════════════════════
let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = 'se_install_dismissed_at';
const INSTALL_DISMISS_COOLDOWN_DAYS = 7;

window.addEventListener('beforeinstallprompt', (e) => {
    // يمنع المتصفح من عرض شريطه الافتراضي كي نتحكم بتوقيت وتصميم العرض بأنفسنا
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new CustomEvent('se:installavailable'));
    PWA.maybeShowInstallBanner();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    PWA.hideInstallBanner();
    localStorage.removeItem(INSTALL_DISMISS_KEY);
});

const PWA = {
    canInstall() {
        return !!deferredInstallPrompt;
    },

    async promptInstall() {
        if (!deferredInstallPrompt) return { outcome: 'unavailable' };
        // prompt() يجب أن يُستدعى مباشرة من ضغطة مستخدم (user gesture) — لا يمكن للمتصفح فتحه تلقائياً بمعزل عن ذلك
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        this.hideInstallBanner();
        return choice;
    },

    /** تسجيل Service Worker — شرط أساسي في Chrome لإظهار "تثبيت التطبيق" */
    registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            console.warn('⚠️ هذا المتصفح لا يدعم Service Worker');
            return;
        }
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then((reg) => console.log('✅ Service Worker مسجّل:', reg.scope))
                .catch((err) => console.error('❌ فشل تسجيل Service Worker:', err));
        });
    },

    /**
     * أقرب ما يمكن تحقيقه لـ"تلقائي" ضمن سياسات المتصفح:
     * المتصفح وحده يقرر متى يُطلق beforeinstallprompt (بعد تفاعل كافٍ مع الموقع)،
     * ولا يمكن لأي كود إجباره على الظهور قبل ذلك. لكن بمجرد إطلاقه، نعرض نحن
     * بانراً مخصصاً وواضحاً فوراً على أي صفحة يتصفحها الزائر - بدل انتظاره
     * ليكتشف خيار التثبيت بنفسه من قائمة الإعدادات.
     */
    maybeShowInstallBanner() {
        if (!this.canInstall()) return;
        const dismissedAt = parseInt(localStorage.getItem(INSTALL_DISMISS_KEY) || '0', 10);
        const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
        if (dismissedAt && daysSinceDismiss < INSTALL_DISMISS_COOLDOWN_DAYS) return;
        this.renderInstallBanner();
    },

    renderInstallBanner() {
        if (document.getElementById('se-install-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'se-install-banner';
        banner.style.cssText = `
            position:fixed; bottom:0; left:0; right:0; z-index:99998;
            background:#0f1f33; color:#fff; padding:14px 16px;
            display:flex; align-items:center; gap:12px;
            box-shadow:0 -4px 20px rgba(0,0,0,0.25);
            font-family:'Tajawal', sans-serif;
            animation: se-slide-up 0.35s ease-out;
        `;
        banner.innerHTML = `
            <style>@keyframes se-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }</style>
            <img src="/img/favicon.png" alt="" style="width:40px; height:40px; border-radius:10px; object-fit:contain; background:#fff; padding:2px; flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <p style="font-weight:900; font-size:13px; margin:0;">ثبّت تطبيق العقارات السورية</p>
                <p style="font-size:11px; color:#c9a24b; margin:2px 0 0;">وصول أسرع بدون متصفح، وإشعارات فور توفرها</p>
            </div>
            <button id="se-install-yes" style="background:#c9a24b; color:#0f1f33; border:none; font-weight:900; font-size:12px; padding:10px 16px; border-radius:12px; cursor:pointer; white-space:nowrap;">تثبيت</button>
            <button id="se-install-no" style="background:transparent; color:#9ca3af; border:none; font-size:18px; cursor:pointer; padding:4px 8px; line-height:1;">&times;</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('se-install-yes').addEventListener('click', () => this.promptInstall());
        document.getElementById('se-install-no').addEventListener('click', () => {
            localStorage.setItem(INSTALL_DISMISS_KEY, Date.now().toString());
            this.hideInstallBanner();
        });
    },

    hideInstallBanner() {
        document.getElementById('se-install-banner')?.remove();
    }
};

// تسجيل الـ Service Worker تلقائياً في كل صفحة تستدعي app.js
PWA.registerServiceWorker();

// ══════════════════════════════════════════════════════════════════
// 10) تعريض كل شيء عبر كائن عام واحد: window.SEApp
// ══════════════════════════════════════════════════════════════════
window.SEApp = {
    supabase,
    Auth,
    Storage,
    DB,
    UI,
    I18n,
    Theme,
    PWA,
    PROPERTY_TYPE_LABELS,
    OWNERSHIP_LABELS,
    DEAL_LABELS,
    CITIES_LIST,
    VERIFICATION_MIN_FOLLOWERS
};

// تطبيق اللغة والسمة المحفوظتين فور تحميل app.js في أي صفحة
I18n.init();
Theme.init();

console.log('🚀 app.js ready — العقارات السورية (Modular)');
