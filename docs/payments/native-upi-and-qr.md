# Razorpay — APK me UPI kyu nahi dikh raha + QR se auto-enrollment

_Last updated: 2026-09-01_

## 1. Web pe UPI dikhta hai, APK me nahi — reason

Web aur native do alag checkout engines hain:

| | Web (`checkout.razorpay.com/v1/checkout.js`) | APK (`capacitor-razorpay` → Razorpay Android SDK) |
|---|---|---|
| Method list | Dashboard + `config.display.blocks` se | Dashboard + **device par installed UPI apps** se |
| `config.display` | Support karta hai | **Ignore** hota hai (hum `src/utils/razorpayNative.ts` me strip bhi karte hain) |
| UPI intent tiles | Browser me collect/QR fallback | Android intent resolve karke GPay/PhonePe/Paytm tiles |

Isliye `UPI_FIRST_CHECKOUT_CONFIG` ka `config.display.blocks.upi` sirf web par asar
karta hai. APK me UPI tab teen wajah se gayab ho sakta hai:

### (a) Android 11+ package visibility — sabse common wajah
Android 11 (API 30) se koi bhi app doosri apps ko "dekh" nahi sakta jab tak
`AndroidManifest.xml` me `<queries>` declare na ho. Razorpay ka native SDK UPI
intent tiles tabhi render karta hai jab wo installed UPI apps resolve kar sake.
Declare na hone par SDK ko lagta hai "koi UPI app nahi hai" → **UPI option hide**.

`android/app/src/main/AndroidManifest.xml` me `<manifest>` ke andar, `<application>`
ke **bahar** ye block add karo:

```xml
<queries>
    <!-- UPI intent apps (GPay, PhonePe, Paytm, BHIM, banking apps) -->
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="upi" android:host="pay" />
    </intent>
    <!-- Razorpay Turbo / bank app fallbacks -->
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="https" />
    </intent>
    <package android:name="com.google.android.apps.nbu.paisa.user" />
    <package android:name="com.phonepe.app" />
    <package android:name="net.one97.paytm" />
    <package android:name="in.org.npci.upiapp" />
    <package android:name="in.amazon.mShop.android.shopping" />
</queries>
```

Iske baad: `npx cap sync android` → clean rebuild → **APK reinstall** (sirf
live-reload se manifest change nahi uthta).

### (b) `method` toggles native call me jaane chahiye
Native plugin `method: { upi: true, ... }` respect karta hai. Agar order
`create-razorpay-order` se banate waqt `method` restrict ho gaya (ya prefill me
`method: 'upi'` bheja gaya jabki contact invalid hai), to sheet card-first khulta
hai. `buildRazorpayPrefill()` valid 10-digit number na hone par `method` omit
karta hai — yehi behaviour chahiye.

### (c) Dashboard / account level
Razorpay Dashboard → Settings → Payment Methods → **UPI ON**. Test mode aur
under-review (non-KYC) accounts par UPI intent flow disabled rehta hai chahe web
par mock dikhe. International/`INR` mismatch par bhi UPI drop ho jata hai.

**Diagnosis order:** dashboard UPI ON? → manifest `<queries>` present? → device par
koi UPI app installed hai? → clean rebuild kiya?

> Note: is Lovable workspace me `android/` folder generate nahi hota, isliye
> manifest patch aur `npx cap sync android` local machine par chalana hoga.

## 2. QR se payment → course me auto-enrollment

Razorpay QR (aur Smart Collect) payments `payment.captured` bhejte hain **bina
`order_id`** ke — unke paas `qr_code_id` hota hai. Purana webhook aise payment ko
`Missing payment identifiers` bolkar reject kar deta tha, isliye QR se paisa aane
par enrollment nahi hoti thi.

Ab `supabase/functions/razorpay-webhook/index.ts` me:

1. `order_id` na ho aur `qr_code_id`/`invoice_id` ho → pseudo order id
   `qr_<payment_id>` bana lete hain.
2. Koi pre-order row nahi milti, isliye existing fallback chalta hai: DB se course
   ka price padhkar `payment.amount` se **exact match** verify hota hai (amount
   tampering guard intact).
3. Match hone par wahi atomic `complete_paid_enrollment` RPC chalta hai → payment
   completed + enrollment upsert + audit log, ek transaction me.
4. `webhook_events` dedupe row last me likhi jaati hai, to Razorpay retry safe hai.

### QR banate waqt zaroori setup
QR create karte samay **notes** dena mandatory hai — Razorpay ye notes payment
entity par copy karta hai, aur webhook wahi se user/course nikalta hai:

```json
{
  "type": "upi_qr",
  "usage": "single_use",
  "fixed_amount": true,
  "payment_amount": 149900,
  "notes": { "user_id": "<auth uid>", "course_id": "12" }
}
```

- `fixed_amount: true` rakho — warna amount check fail hoga aur enrollment nahi hogi
  (ye jaan-boojhkar strict hai, taaki ₹1 bhejkar koi course na khol le).
- Dashboard → Webhooks me `payment.captured` event subscribe hona chahiye
  (`razorpay-webhook` URL par), aur `RAZORPAY_WEBHOOK_SECRET` set hona chahiye.
- Static/reusable QR (notes ke bina) se auto-enrollment **nahi** hogi — wo admin
  panel se manual reconcile karna padega. Har student ke liye per-course QR banao.
