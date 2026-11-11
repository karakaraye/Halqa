import { Lang, PathwayId, StepId } from '@/types/halqa';

// Patient-facing content. Plain-language, non-stigmatising, written at
// ~6th-grade reading level. Translations must be reviewed by certified
// medical translators before clinical use.

export const LANGS: { id: Lang; label: string; native: string; dir: 'ltr' | 'rtl'; speech: string }[] = [
  { id: 'en', label: 'English', native: 'English', dir: 'ltr', speech: 'en-GB' },
  { id: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl', speech: 'ar-SA' },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr', speech: 'hi-IN' },
  { id: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl', speech: 'ur-PK' },
];

type Dict = Record<string, string>;

export const UI: Record<Lang, Dict> = {
  en: {
    hello: 'Hello', resultTab: 'My result', journeyTab: 'My journey', helpTab: 'Help',
    title: 'Your screening result', notDiagnosis: 'This is not a diagnosis.', nextStep: 'Your next step',
    within: 'Recommended within {n} days', listen: 'Listen', stop: 'Stop',
    reassure: 'You are not alone. We will guide you at every step.',
    checkTitle: 'Quick check — did we explain it well?',
    q1: 'What does this result mean?', q1a: 'I definitely have a serious disease', q1b: 'I need another test to know more', q1c: 'It means nothing, I can ignore it',
    q2: 'What should you do next?', q2a: 'Follow the next step with my care team', q2b: 'Wait until next year’s screening', q2c: 'Only go if I feel unwell',
    confidenceQ: 'How confident do you feel about what happens next?', notAtAll: 'Not at all', very: 'Very',
    confirm: 'I understand — confirm', confirmed: 'Thank you. Your care team has been told.',
    wrongHelp: 'That’s okay — a nurse will call you to explain in your language.',
    yourTeam: 'Your care team', responsible: 'Responsible for your next step', expectedBy: 'Expected by',
    callback: 'Request a call back', callbackDone: 'A nurse will call you soon',
    message: 'Message my care team', placeholder: 'Type your question…', send: 'Send',
    interpreter: 'I need an interpreter', interpreterOn: 'Interpreter will join your calls',
    chooseSlot: 'Choose your appointment', booked: 'Your appointment', now: 'Now', done: 'Done',
    completed: 'Your follow-up is complete. Your doctor has documented the result and your plan.',
    smsLabel: 'Message you received',
    sms: 'Halqa: You have a new screening result. It is not a diagnosis. Open your secure link or reply 1 for a call back.',
    critical: 'Because this needs attention soon, a nurse will call you first.',
    teamReply: 'Care team', you: 'You', ackAlready: 'You confirmed you understand',
    waitingAccept: 'Your referral is with the specialist team. We will let you know when they confirm.',
  },
  ar: {
    hello: 'مرحباً', resultTab: 'نتيجتي', journeyTab: 'رحلتي', helpTab: 'المساعدة',
    title: 'نتيجة فحصك', notDiagnosis: 'هذه ليست نتيجة تشخيص نهائية.', nextStep: 'خطوتك التالية',
    within: 'يُنصح به خلال {n} أيام', listen: 'استمع', stop: 'إيقاف',
    reassure: 'لست وحدك. سنرشدك في كل خطوة.',
    checkTitle: 'سؤال سريع — هل كان شرحنا واضحاً؟',
    q1: 'ماذا تعني هذه النتيجة؟', q1a: 'أنني مصاب بالتأكيد بمرض خطير', q1b: 'أحتاج إلى فحص آخر لمعرفة المزيد', q1c: 'لا تعني شيئاً، يمكنني تجاهلها',
    q2: 'ماذا يجب أن تفعل بعد ذلك؟', q2a: 'متابعة الخطوة التالية مع فريق رعايتي', q2b: 'الانتظار حتى فحص العام القادم', q2c: 'الذهاب فقط إذا شعرت بتعب',
    confidenceQ: 'ما مدى ثقتك بما سيحدث بعد ذلك؟', notAtAll: 'غير واثق', very: 'واثق جداً',
    confirm: 'فهمت — تأكيد', confirmed: 'شكراً لك. تم إبلاغ فريق رعايتك.',
    wrongHelp: 'لا بأس — ستتصل بك ممرضة لتشرح لك بلغتك.',
    yourTeam: 'فريق رعايتك', responsible: 'المسؤول عن خطوتك التالية', expectedBy: 'متوقع بحلول',
    callback: 'طلب معاودة الاتصال', callbackDone: 'ستتصل بك ممرضة قريباً',
    message: 'مراسلة فريق رعايتي', placeholder: 'اكتب سؤالك…', send: 'إرسال',
    interpreter: 'أحتاج إلى مترجم', interpreterOn: 'سينضم مترجم إلى مكالماتك',
    chooseSlot: 'اختر موعدك', booked: 'موعدك', now: 'الآن', done: 'تم',
    completed: 'اكتملت متابعتك. وثّق طبيبك النتيجة وخطتك.',
    smsLabel: 'الرسالة التي وصلتك',
    sms: 'حلقة: لديك نتيجة فحص جديدة. هذه ليست نتيجة تشخيص. افتح الرابط الآمن أو أرسل 1 لمعاودة الاتصال.',
    critical: 'لأن هذه النتيجة تحتاج إلى اهتمام قريب، ستتصل بك ممرضة أولاً.',
    teamReply: 'فريق الرعاية', you: 'أنت', ackAlready: 'أكدتَ فهمك للنتيجة',
    waitingAccept: 'تحويلك الآن لدى الفريق المختص. سنخبرك عندما يؤكدون.',
  },
  hi: {
    hello: 'नमस्ते', resultTab: 'मेरा परिणाम', journeyTab: 'मेरी यात्रा', helpTab: 'मदद',
    title: 'आपकी स्क्रीनिंग का परिणाम', notDiagnosis: 'यह कोई निदान नहीं है।', nextStep: 'आपका अगला कदम',
    within: '{n} दिनों के अंदर करवाने की सलाह', listen: 'सुनें', stop: 'रोकें',
    reassure: 'आप अकेले नहीं हैं। हम हर कदम पर आपका मार्गदर्शन करेंगे।',
    checkTitle: 'छोटा सा सवाल — क्या हमने ठीक से समझाया?',
    q1: 'इस परिणाम का क्या मतलब है?', q1a: 'मुझे निश्चित रूप से गंभीर बीमारी है', q1b: 'और जानने के लिए मुझे एक और जाँच चाहिए', q1c: 'इसका कोई मतलब नहीं, इसे नज़रअंदाज़ कर सकते हैं',
    q2: 'आपको आगे क्या करना चाहिए?', q2a: 'अपनी देखभाल टीम के साथ अगला कदम उठाना', q2b: 'अगले साल की जाँच तक इंतज़ार करना', q2c: 'तभी जाना जब तबीयत खराब लगे',
    confidenceQ: 'आगे क्या होगा, इसे लेकर आप कितना आश्वस्त महसूस करते हैं?', notAtAll: 'बिल्कुल नहीं', very: 'बहुत',
    confirm: 'मैं समझ गया/गई — पुष्टि करें', confirmed: 'धन्यवाद। आपकी देखभाल टीम को बता दिया गया है।',
    wrongHelp: 'कोई बात नहीं — एक नर्स आपको आपकी भाषा में समझाने के लिए कॉल करेगी।',
    yourTeam: 'आपकी देखभाल टीम', responsible: 'आपके अगले कदम के लिए ज़िम्मेदार', expectedBy: 'अपेक्षित तिथि',
    callback: 'कॉल बैक का अनुरोध करें', callbackDone: 'एक नर्स जल्द ही आपको कॉल करेगी',
    message: 'अपनी देखभाल टीम को संदेश भेजें', placeholder: 'अपना सवाल लिखें…', send: 'भेजें',
    interpreter: 'मुझे दुभाषिया चाहिए', interpreterOn: 'आपकी कॉल में दुभाषिया शामिल होगा',
    chooseSlot: 'अपना अपॉइंटमेंट चुनें', booked: 'आपका अपॉइंटमेंट', now: 'अभी', done: 'पूरा',
    completed: 'आपकी फॉलो-अप पूरी हो गई है। आपके डॉक्टर ने परिणाम और आपकी योजना दर्ज कर दी है।',
    smsLabel: 'आपको मिला संदेश',
    sms: 'हल्क़ा: आपका एक नया स्क्रीनिंग परिणाम आया है। यह निदान नहीं है। अपना सुरक्षित लिंक खोलें या कॉल बैक के लिए 1 लिखकर भेजें।',
    critical: 'क्योंकि इस पर जल्दी ध्यान देना ज़रूरी है, एक नर्स पहले आपको कॉल करेगी।',
    teamReply: 'देखभाल टीम', you: 'आप', ackAlready: 'आपने समझने की पुष्टि की',
    waitingAccept: 'आपका रेफ़रल विशेषज्ञ टीम के पास है। पुष्टि होते ही हम आपको बताएँगे।',
  },
  ur: {
    hello: 'السلام علیکم', resultTab: 'میرا نتیجہ', journeyTab: 'میرا سفر', helpTab: 'مدد',
    title: 'آپ کی اسکریننگ کا نتیجہ', notDiagnosis: 'یہ تشخیص نہیں ہے۔', nextStep: 'آپ کا اگلا قدم',
    within: '{n} دن کے اندر کروانے کا مشورہ', listen: 'سنیں', stop: 'روکیں',
    reassure: 'آپ اکیلے نہیں ہیں۔ ہم ہر قدم پر آپ کی رہنمائی کریں گے۔',
    checkTitle: 'ایک فوری سوال — کیا ہم نے ٹھیک سے سمجھایا؟',
    q1: 'اس نتیجے کا کیا مطلب ہے؟', q1a: 'مجھے یقینی طور پر کوئی سنگین بیماری ہے', q1b: 'مزید جاننے کے لیے مجھے ایک اور ٹیسٹ کی ضرورت ہے', q1c: 'اس کا کوئی مطلب نہیں، اسے نظرانداز کیا جا سکتا ہے',
    q2: 'آپ کو آگے کیا کرنا چاہیے؟', q2a: 'اپنی نگہداشت ٹیم کے ساتھ اگلا قدم اٹھانا', q2b: 'اگلے سال کی اسکریننگ تک انتظار کرنا', q2c: 'صرف تب جانا جب طبیعت خراب ہو',
    confidenceQ: 'آگے کیا ہوگا، اس بارے میں آپ کتنا پُراعتماد محسوس کرتے ہیں؟', notAtAll: 'بالکل نہیں', very: 'بہت زیادہ',
    confirm: 'میں سمجھ گیا/گئی — تصدیق کریں', confirmed: 'شکریہ۔ آپ کی نگہداشت ٹیم کو بتا دیا گیا ہے۔',
    wrongHelp: 'کوئی بات نہیں — ایک نرس آپ کو آپ کی زبان میں سمجھانے کے لیے کال کرے گی۔',
    yourTeam: 'آپ کی نگہداشت ٹیم', responsible: 'آپ کے اگلے قدم کے ذمہ دار', expectedBy: 'متوقع تاریخ',
    callback: 'کال بیک کی درخواست کریں', callbackDone: 'ایک نرس جلد آپ کو کال کرے گی',
    message: 'اپنی نگہداشت ٹیم کو پیغام بھیجیں', placeholder: 'اپنا سوال لکھیں…', send: 'بھیجیں',
    interpreter: 'مجھے ترجمان کی ضرورت ہے', interpreterOn: 'آپ کی کالز میں ترجمان شامل ہوگا',
    chooseSlot: 'اپنی اپائنٹمنٹ منتخب کریں', booked: 'آپ کی اپائنٹمنٹ', now: 'ابھی', done: 'مکمل',
    completed: 'آپ کا فالو اپ مکمل ہو گیا ہے۔ آپ کے ڈاکٹر نے نتیجہ اور آپ کا منصوبہ درج کر دیا ہے۔',
    smsLabel: 'آپ کو موصول ہونے والا پیغام',
    sms: 'حلقہ: آپ کا ایک نیا اسکریننگ نتیجہ آیا ہے۔ یہ تشخیص نہیں ہے۔ اپنا محفوظ لنک کھولیں یا کال بیک کے لیے 1 بھیجیں۔',
    critical: 'چونکہ اس پر جلد توجہ کی ضرورت ہے، ایک نرس پہلے آپ کو کال کرے گی۔',
    teamReply: 'نگہداشت ٹیم', you: 'آپ', ackAlready: 'آپ نے سمجھنے کی تصدیق کی',
    waitingAccept: 'آپ کا ریفرل ماہر ٹیم کے پاس ہے۔ تصدیق ہوتے ہی ہم آپ کو بتائیں گے۔',
  },
};

export const EXPLAIN: Record<PathwayId, Record<Lang, { body: string; next: string }>> = {
  CRC_FIT: {
    en: { body: 'Your stool test (FIT) found a small amount of blood that cannot be seen by eye. This is common and is often caused by things like piles or polyps. Most people with this result do not have cancer. The next step is a colonoscopy — a camera test of the bowel — to find the cause.', next: 'Colonoscopy' },
    ar: { body: 'أظهر فحص البراز (FIT) وجود كمية صغيرة من الدم لا تُرى بالعين. هذه النتيجة شائعة وغالباً ما يكون سببها البواسير أو الزوائد اللحمية. معظم الأشخاص الذين يحصلون على هذه النتيجة لا يعانون من السرطان. الخطوة التالية هي تنظير القولون — فحص بالكاميرا للأمعاء — لمعرفة السبب.', next: 'تنظير القولون' },
    hi: { body: 'आपकी मल जाँच (FIT) में थोड़ा सा खून मिला है जो आँखों से दिखाई नहीं देता। यह आम है और अक्सर बवासीर या पॉलिप जैसी चीज़ों के कारण होता है। इस परिणाम वाले ज़्यादातर लोगों को कैंसर नहीं होता। अगला कदम कोलोनोस्कोपी है — आँत की कैमरे से जाँच — ताकि कारण पता चल सके।', next: 'कोलोनोस्कोपी' },
    ur: { body: 'آپ کے پاخانے کے ٹیسٹ (FIT) میں تھوڑا سا خون پایا گیا ہے جو آنکھ سے نظر نہیں آتا۔ یہ عام بات ہے اور اکثر بواسیر یا پولیپ جیسی چیزوں کی وجہ سے ہوتا ہے۔ اس نتیجے والے زیادہ تر لوگوں کو کینسر نہیں ہوتا۔ اگلا قدم کولونوسکوپی ہے — آنت کا کیمرے سے معائنہ — تاکہ وجہ معلوم ہو سکے۔', next: 'کولونوسکوپی' },
  },
  BREAST_BIRADS: {
    en: { body: 'Your mammogram showed an area that needs a closer look. Many areas like this turn out not to be cancer. The next step is a small test called a biopsy, where a doctor takes a tiny sample to check it.', next: 'Biopsy' },
    ar: { body: 'أظهر تصوير الثدي الشعاعي (الماموجرام) منطقة تحتاج إلى فحص أدق. كثير من هذه المناطق تكون غير سرطانية. الخطوة التالية هي فحص بسيط يسمى الخزعة، حيث يأخذ الطبيب عينة صغيرة لفحصها.', next: 'الخزعة' },
    hi: { body: 'आपकी मैमोग्राम जाँच में एक हिस्सा दिखा है जिसे ध्यान से देखने की ज़रूरत है। ऐसे कई हिस्से कैंसर नहीं निकलते। अगला कदम बायोप्सी नाम की एक छोटी जाँच है, जिसमें डॉक्टर जाँच के लिए एक छोटा सा नमूना लेते हैं।', next: 'बायोप्सी' },
    ur: { body: 'آپ کے میموگرام میں ایک حصہ نظر آیا ہے جسے غور سے دیکھنے کی ضرورت ہے۔ ایسے کئی حصے کینسر نہیں نکلتے۔ اگلا قدم بائیوپسی نامی ایک چھوٹا ٹیسٹ ہے، جس میں ڈاکٹر جانچ کے لیے ایک چھوٹا سا نمونہ لیتے ہیں۔', next: 'بائیوپسی' },
  },
  CERVICAL_HPV: {
    en: { body: 'Your cervical screening found HPV and some changed cells. These changes are common and are usually not cancer. The next step is a colposcopy — a close look at the cervix — so any changes can be treated early.', next: 'Colposcopy' },
    ar: { body: 'أظهر فحص عنق الرحم وجود فيروس الورم الحليمي البشري (HPV) وبعض التغيرات في الخلايا. هذه التغيرات شائعة وعادةً ليست سرطاناً. الخطوة التالية هي التنظير المهبلي — فحص دقيق لعنق الرحم — لعلاج أي تغيرات مبكراً.', next: 'التنظير المهبلي' },
    hi: { body: 'आपकी सर्वाइकल स्क्रीनिंग में HPV और कोशिकाओं में कुछ बदलाव मिले हैं। ये बदलाव आम हैं और आमतौर पर कैंसर नहीं होते। अगला कदम कोल्पोस्कोपी है — गर्भाशय ग्रीवा की नज़दीक से जाँच — ताकि किसी भी बदलाव का जल्दी इलाज हो सके।', next: 'कोल्पोस्कोपी' },
    ur: { body: 'آپ کی سروائیکل اسکریننگ میں HPV اور خلیوں میں کچھ تبدیلیاں پائی گئی ہیں۔ یہ تبدیلیاں عام ہیں اور عام طور پر کینسر نہیں ہوتیں۔ اگلا قدم کولپوسکوپی ہے — رحم کی گردن کا قریب سے معائنہ — تاکہ کسی بھی تبدیلی کا جلد علاج ہو سکے۔', next: 'کولپوسکوپی' },
  },
  DIABETES_HBA1C: {
    en: { body: 'Your blood test showed a high sugar level (HbA1c). This may mean diabetes, but we need to repeat the test to be sure. Diabetes can be controlled well with the right care.', next: 'Repeat blood test' },
    ar: { body: 'أظهر فحص الدم ارتفاعاً في مستوى السكر التراكمي (HbA1c). قد يعني ذلك الإصابة بالسكري، لكننا نحتاج إلى إعادة الفحص للتأكد. يمكن التحكم في السكري بشكل جيد مع الرعاية المناسبة.', next: 'إعادة فحص الدم' },
    hi: { body: 'आपकी खून की जाँच में शुगर का स्तर (HbA1c) ज़्यादा आया है। इसका मतलब डायबिटीज़ हो सकता है, लेकिन पक्का करने के लिए हमें जाँच दोबारा करनी होगी। सही देखभाल से डायबिटीज़ को अच्छी तरह नियंत्रित किया जा सकता है।', next: 'दोबारा खून की जाँच' },
    ur: { body: 'آپ کے خون کے ٹیسٹ میں شوگر کی سطح (HbA1c) زیادہ آئی ہے۔ اس کا مطلب ذیابیطس ہو سکتا ہے، لیکن تصدیق کے لیے ہمیں ٹیسٹ دوبارہ کرنا ہوگا۔ صحیح دیکھ بھال سے ذیابیطس کو اچھی طرح قابو میں رکھا جا سکتا ہے۔', next: 'خون کا دوبارہ ٹیسٹ' },
  },
};

export const STEP_LABEL: Record<StepId, Record<Lang, string>> = {
  NOTIFY: { en: 'Result shared with you', ar: 'تمت مشاركة النتيجة معك', hi: 'परिणाम आपके साथ साझा किया गया', ur: 'نتیجہ آپ کے ساتھ شیئر کیا گیا' },
  ACK: { en: 'You confirmed you understand', ar: 'أكدتَ فهمك للنتيجة', hi: 'आपने समझने की पुष्टि की', ur: 'آپ نے سمجھنے کی تصدیق کی' },
  CONSULT: { en: 'Talk with your doctor', ar: 'التحدث مع طبيبك', hi: 'अपने डॉक्टर से बात', ur: 'اپنے ڈاکٹر سے بات' },
  CONFIRM_TEST: { en: 'Repeat test to confirm', ar: 'إعادة الفحص للتأكيد', hi: 'पुष्टि के लिए दोबारा जाँच', ur: 'تصدیق کے لیے دوبارہ ٹیسٹ' },
  REFER: { en: 'Referred to a specialist', ar: 'تحويلك إلى طبيب مختص', hi: 'विशेषज्ञ के पास भेजा गया', ur: 'ماہر ڈاکٹر کے پاس بھیجا گیا' },
  ACCEPT: { en: 'Specialist team accepted you', ar: 'قبول الفريق المختص لحالتك', hi: 'विशेषज्ञ टीम ने स्वीकार किया', ur: 'ماہر ٹیم نے قبول کیا' },
  BOOK: { en: 'Appointment booked', ar: 'تم حجز الموعد', hi: 'अपॉइंटमेंट बुक हुआ', ur: 'اپائنٹمنٹ بک ہو گئی' },
  ATTEND: { en: 'Follow-up test done', ar: 'تم إجراء الفحص', hi: 'आगे की जाँच हुई', ur: 'اگلا ٹیسٹ ہو گیا' },
  OUTCOME: { en: 'Results explained to you', ar: 'شرح النتائج لك', hi: 'परिणाम आपको समझाए गए', ur: 'نتائج آپ کو سمجھائے گئے' },
  CARE_PLAN: { en: 'Your care plan started', ar: 'بدء خطة رعايتك', hi: 'आपकी देखभाल योजना शुरू', ur: 'آپ کا نگہداشت منصوبہ شروع' },
  CLOSE: { en: 'All done — safely completed', ar: 'اكتملت رحلتك بأمان', hi: 'सब पूरा — सुरक्षित रूप से', ur: 'سب مکمل — محفوظ طریقے سے' },
};

export const t = (lang: Lang, key: string, vars?: Record<string, string | number>) => {
  let s = UI[lang][key] ?? UI.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
};
