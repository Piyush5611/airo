export const GOAL_LABELS = {
  leads: 'Leads (enquiries)',
  appointments: 'Appointments (bookings, visits)',
  sales: 'Sales (online orders)',
  awareness: 'Awareness (reach people)',
  traffic: 'Traffic (website visits)'
};

const PLAYBOOKS = [
  {
    key: 'real_estate',
    label: 'Real estate',
    goals: [
      ['leads', 'Site visit and price enquiries; the everyday campaign'],
      ['awareness', 'New project launch or entering a new city'],
      ['traffic', 'Project page or virtual tour, to build a retargeting audience'],
      ['appointments', 'Booked site visits on fixed dates or open-house weekends']
    ],
    leadPath: 'Meta instant form or WhatsApp/Messenger chat for site visits; Google search for project + city',
    special: 'HOUSING',
    ages: [25, 55],
    interests: ['Real estate', 'Home loans', 'Property finder', '99acres', 'MagicBricks', 'Housing.com', 'Interior design', 'Mortgage loans'],
    angles: ['Location and connectivity', 'Price per sqft or total price', 'Possession date or ready to move', 'Amenities and lifestyle', 'Builder trust and RERA'],
    creatives: ['Real project or sample flat photo with price and location', 'Site visit offer', 'Floor plan with size', 'Walkthrough video'],
    keywords: ['2bhk flats in <city>', '3bhk apartment <locality>', 'ready to move flats <city>', 'new projects in <city>', 'plots in <city>'],
    negatives: ['rent', 'pg', 'jobs', 'salary', 'resale', 'second hand', 'free', 'course'],
    kpis: ['Cost per lead', 'Site visits booked', 'Lead to site-visit rate'],
    tips: ['Always show price or price range and possession date; leads are much better quality.', 'Call new leads within 5 minutes.', 'Housing ads in India may need the Housing special category; Meta then decides age and gender.']
  },
  {
    key: 'ecommerce',
    label: 'Ecommerce / D2C',
    goals: [
      ['sales', 'Orders on the website; needs the Meta pixel for best results'],
      ['traffic', 'New store or before the pixel has purchase data; builds retargeting audiences'],
      ['awareness', 'New brand, new product line or a big sale coming up'],
      ['leads', 'COD or WhatsApp orders, bulk or custom orders']
    ],
    leadPath: 'Website purchase with the Meta pixel; Google Shopping and search',
    ages: [18, 45],
    interests: ['Online shopping', 'Engaged shoppers', 'Amazon', 'Flipkart', 'Myntra', 'Fashion', 'Discounts and offers'],
    angles: ['Offer or discount', 'Problem and product fix', 'Social proof and reviews', 'New launch', 'Free delivery or COD'],
    creatives: ['Product in use, not just packshot', 'Before / after', 'Customer review card', 'Carousel of best sellers'],
    keywords: ['buy <product> online', '<product> price', 'best <product> for <use>', '<product> near me'],
    negatives: ['free', 'jobs', 'wholesale', 'second hand', 'repair', 'how to make'],
    kpis: ['ROAS', 'Cost per purchase', 'Add to cart rate'],
    tips: ['Install the Meta pixel and conversions API before scaling.', 'Retarget website visitors and add-to-cart users.', 'Show the price and offer in the first line.']
  },
  {
    key: 'it_saas',
    label: 'IT / Software / SaaS',
    goals: [
      ['leads', 'Demo or quote requests'],
      ['appointments', 'Booked demo calls'],
      ['traffic', 'Blog, free tool or pricing page, to build a retargeting audience'],
      ['awareness', 'New product or feature launch']
    ],
    leadPath: 'Demo request form on website or Meta instant form; Google search for the problem the software solves',
    ages: [24, 55],
    interests: ['Software', 'Small business', 'Entrepreneurship', 'Business software', 'Startup company', 'Technology'],
    angles: ['Pain the software removes', 'Time or cost saved', 'Free trial or demo', 'Customer logos or case study'],
    creatives: ['Product screen with one clear benefit', 'Short demo video', 'Customer result card'],
    keywords: ['<software type> software', 'best <software type> for small business', '<software type> india', '<competitor> alternative'],
    negatives: ['free download', 'crack', 'jobs', 'course', 'tutorial', 'internship'],
    kpis: ['Cost per demo', 'Demo to paid rate', 'Cost per SQL'],
    tips: ['Ask one qualifying question in the form (team size or industry).', 'Google search usually brings higher intent than Meta for B2B.']
  },
  {
    key: 'edtech',
    label: 'Edtech / Coaching',
    goals: [
      ['leads', 'Course and counselling enquiries'],
      ['appointments', 'Free demo class or counselling slot bookings'],
      ['awareness', 'New batch, new centre or results announcement'],
      ['traffic', 'Webinar or course landing page']
    ],
    leadPath: 'Meta instant form or WhatsApp for counselling; Google search for course + city',
    ages: [17, 35],
    interests: ['Education', 'Online learning', 'Competitive exams', 'Career', 'Students', 'Higher education'],
    angles: ['Results and toppers', 'Free demo class', 'Faculty and method', 'Batch start date', 'Placement or career outcome'],
    creatives: ['Topper or result card (real only)', 'Faculty video', 'Batch timing poster', 'Free demo class offer'],
    keywords: ['<course> coaching in <city>', 'best <exam> coaching', '<course> online classes', '<course> fees'],
    negatives: ['free pdf', 'notes', 'jobs', 'salary', 'syllabus pdf', 'answer key'],
    kpis: ['Cost per lead', 'Demo attended', 'Admissions'],
    tips: ['Target parents too for school-age courses.', 'Use a batch start date for real urgency.']
  },
  {
    key: 'college',
    label: 'College / University / School',
    goals: [
      ['leads', 'Admission enquiries during admission season'],
      ['awareness', 'Off-season brand building: results, placements, campus life'],
      ['appointments', 'Campus visits and counselling sessions'],
      ['traffic', 'Prospectus, fee or course pages']
    ],
    leadPath: 'Admission enquiry form; Google search for course + college + city',
    ages: [17, 45],
    interests: ['Higher education', 'University', 'Engineering', 'MBA', 'Students', 'Parenting'],
    angles: ['Placements and recruiters', 'Accreditation and ranking', 'Campus and facilities', 'Admission deadline', 'Scholarships'],
    creatives: ['Campus photo or video', 'Placement highlights (real only)', 'Admission open poster with deadline'],
    keywords: ['<course> colleges in <city>', 'best <course> college', '<course> admission 2026', '<college> fees'],
    negatives: ['jobs', 'result', 'admit card', 'syllabus', 'question paper', 'free'],
    kpis: ['Cost per application', 'Counselling calls', 'Admissions'],
    tips: ['Run separate ads for students and parents.', 'Peak months are around board results and admission windows.']
  },
  {
    key: 'restaurant',
    label: 'Restaurant / Cafe / Cloud kitchen',
    goals: [
      ['awareness', 'People near the outlet; new outlet, new menu or festival offer'],
      ['leads', 'WhatsApp or Messenger orders, party and catering enquiries'],
      ['appointments', 'Table bookings'],
      ['traffic', 'Zomato/Swiggy page or online menu']
    ],
    leadPath: 'Calls, WhatsApp orders, directions or Zomato/Swiggy link; local radius targeting',
    ages: [18, 45],
    interests: ['Restaurants', 'Food', 'Zomato', 'Swiggy', 'Dining out', 'Cafe'],
    angles: ['Signature dish', 'Offer or combo', 'Ambience and occasions', 'Fast delivery', 'Reviews'],
    creatives: ['Close-up food photo or reel', 'Combo price card', 'Weekend or festival special'],
    keywords: ['restaurant near me', '<cuisine> restaurant in <area>', 'best cafe in <area>', 'food delivery <area>'],
    negatives: ['jobs', 'recipe', 'franchise', 'how to make', 'salary'],
    kpis: ['Cost per call or order', 'Orders', 'Footfall'],
    tips: ['Target 3-8 km around the outlet.', 'Run ads at lunch and dinner times.']
  },
  {
    key: 'hotel',
    label: 'Hotel / Resort / Homestay',
    goals: [
      ['sales', 'Direct bookings on the website'],
      ['leads', 'WhatsApp booking, wedding and event enquiries'],
      ['awareness', 'New property, season or festival packages'],
      ['traffic', 'Rooms and packages pages, to build a retargeting audience']
    ],
    leadPath: 'Direct booking website or WhatsApp booking; target source cities of travellers',
    ages: [25, 55],
    interests: ['Travel', 'Hotels', 'Weekend getaways', 'Frequent travellers', 'MakeMyTrip', 'Booking.com', 'Vacations'],
    angles: ['Location and view', 'Weekend package price', 'Experiences and food', 'Family or couple stays', 'Direct booking benefit'],
    creatives: ['Room and view photos or reel', 'Package price card', 'Guest review'],
    keywords: ['resort near <city>', 'hotels in <destination>', 'weekend getaway from <city>', '<destination> homestay'],
    negatives: ['jobs', 'hotel management course', 'salary', 'free'],
    kpis: ['Cost per booking', 'ROAS', 'Enquiries'],
    tips: ['Target the cities guests travel from, not only the hotel city.', 'Push weekends and long holidays early.']
  },
  {
    key: 'healthcare',
    label: 'Clinic / Hospital / Diagnostics',
    goals: [
      ['appointments', 'Consultation or test bookings'],
      ['leads', 'Treatment and package enquiries'],
      ['awareness', 'New clinic, health camp or a new doctor or service'],
      ['traffic', 'Treatment or health package pages']
    ],
    leadPath: 'Appointment booking by call, WhatsApp or form; local radius',
    ages: [25, 65],
    interests: ['Health', 'Practo', 'Health and wellness', 'Family', 'Parenting'],
    angles: ['Doctor experience', 'Specific treatment or test', 'Easy appointment', 'Packages and price', 'Nearby and timings'],
    creatives: ['Doctor photo with qualification', 'Health package price card', 'Clinic photo'],
    keywords: ['<specialist> near me', '<treatment> in <city>', 'best <specialist> in <area>', '<test> price'],
    negatives: ['jobs', 'course', 'salary', 'free', 'home remedy', 'symptoms meaning'],
    kpis: ['Cost per appointment', 'Calls', 'Show-up rate'],
    tips: ['Health ads cannot imply a personal condition ("Do you have diabetes?").', 'Avoid before/after medical images.']
  },
  {
    key: 'beauty_fitness',
    label: 'Salon / Spa / Gym',
    goals: [
      ['appointments', 'Service bookings or a free trial session'],
      ['leads', 'Membership, bridal and package enquiries'],
      ['awareness', 'New branch, festival or wedding season offer near the outlet'],
      ['traffic', 'Price list or Instagram profile']
    ],
    leadPath: 'Booking by WhatsApp or call; local radius',
    ages: [18, 45],
    interests: ['Beauty salons', 'Fitness', 'Gym', 'Spa', 'Skin care', 'Bridal makeup'],
    angles: ['Trial or first-visit offer', 'Results and transformations (real)', 'Trainer or stylist skill', 'Packages'],
    creatives: ['Reel of service or workout', 'Offer card', 'Client review'],
    keywords: ['salon near me', 'gym in <area>', 'bridal makeup <city>', 'spa near me'],
    negatives: ['jobs', 'course', 'salary', 'franchise', 'free'],
    kpis: ['Cost per booking', 'Trial to member rate'],
    tips: ['Target 3-5 km around the outlet.', 'Women-only targeting only if the service is for women.']
  },
  {
    key: 'travel',
    label: 'Travel agency / Tours',
    goals: [
      ['leads', 'Package enquiries'],
      ['awareness', 'New destination or season (summer, holidays, honeymoon)'],
      ['traffic', 'Package pages, to build a retargeting audience'],
      ['sales', 'Direct package bookings on the website']
    ],
    leadPath: 'WhatsApp or form enquiry for packages',
    ages: [24, 55],
    interests: ['Travel', 'Frequent travellers', 'International travel', 'Honeymoon', 'Adventure travel'],
    angles: ['Package price per person', 'Destination dream', 'All inclusive and hassle free', 'Limited dates'],
    creatives: ['Destination reel', 'Package itinerary card', 'Happy traveller photo'],
    keywords: ['<destination> tour package', '<destination> honeymoon package', 'tour packages from <city>'],
    negatives: ['jobs', 'visa rejection', 'free', 'course', 'salary'],
    kpis: ['Cost per lead', 'Bookings'],
    tips: ['Show price per person and number of nights.', 'Plan 6-8 weeks before the season.']
  },
  {
    key: 'automobile',
    label: 'Automobile dealer / Service',
    goals: [
      ['leads', 'Price quote, exchange and finance enquiries'],
      ['appointments', 'Test drive or service bookings'],
      ['awareness', 'New model launch or festival offers'],
      ['traffic', 'Model or offer pages']
    ],
    leadPath: 'Test drive or service booking form, call or WhatsApp',
    ages: [22, 55],
    interests: ['Cars', 'Automobiles', 'Car dealership', 'Two-wheelers', 'Auto loans'],
    angles: ['On-road price and EMI', 'Test drive', 'Exchange offer', 'Service package'],
    creatives: ['Car or bike photo with EMI', 'Showroom photo', 'Offer card'],
    keywords: ['<model> on road price <city>', '<brand> showroom near me', 'car service near me'],
    negatives: ['jobs', 'second hand', 'used', 'toy', 'games', 'salary'],
    kpis: ['Cost per test drive', 'Bookings'],
    tips: ['Lead with EMI and offer; it brings ready buyers.']
  },
  {
    key: 'finance',
    label: 'Loans / Insurance / Finance',
    goals: [
      ['leads', 'Loan, policy or investment enquiries'],
      ['awareness', 'Trust building for a new brand or branch'],
      ['traffic', 'EMI calculator, plan comparison or landing page'],
      ['appointments', 'Advisor call bookings']
    ],
    leadPath: 'Instant form or website form with eligibility questions',
    special: 'CREDIT',
    ages: [23, 60],
    interests: ['Personal finance', 'Insurance', 'Loans', 'Investment', 'Mutual funds'],
    angles: ['Low rate or premium', 'Fast approval', 'Trust and licence', 'Tax saving'],
    creatives: ['Simple benefit card', 'Advisor photo', 'Calculator style visual'],
    keywords: ['<loan type> interest rate', 'best term insurance', '<loan type> apply online'],
    negatives: ['jobs', 'free', 'course', 'salary', 'loan app fraud'],
    kpis: ['Cost per qualified lead', 'Approval rate'],
    tips: ['Credit ads may need the Credit special category.', 'Add one eligibility question to filter leads.']
  },
  {
    key: 'local_services',
    label: 'Local services (repair, cleaning, interiors, legal, CA)',
    goals: [
      ['leads', 'Service enquiries and calls'],
      ['appointments', 'Home visit or consultation bookings'],
      ['awareness', 'Starting in a new area or a seasonal service'],
      ['traffic', 'Portfolio or price page']
    ],
    leadPath: 'Calls and WhatsApp; Google search "near me"',
    ages: [25, 60],
    interests: ['Home improvement', 'Interior design', 'Homeowners', 'Small business'],
    angles: ['Fast response', 'Price or free inspection (only if true)', 'Experience and reviews', 'Area served'],
    creatives: ['Work photos (real)', 'Before / after of the job', 'Price card'],
    keywords: ['<service> near me', '<service> in <city>', 'best <service> <area>'],
    negatives: ['jobs', 'course', 'salary', 'diy', 'how to'],
    kpis: ['Cost per call', 'Jobs booked'],
    tips: ['Google search "near me" usually works best for urgent services.']
  },
  {
    key: 'retail_store',
    label: 'Retail store / Showroom',
    goals: [
      ['awareness', 'Footfall from people near the store; sale, festival or new stock'],
      ['leads', 'Product and price enquiries on WhatsApp or form'],
      ['traffic', 'Catalogue or store location page'],
      ['sales', 'Online orders, if the store sells on a website']
    ],
    leadPath: 'Store visits, calls, WhatsApp catalogue; local radius',
    ages: [18, 55],
    interests: ['Shopping', 'Fashion', 'Jewellery', 'Electronics', 'Home furnishings'],
    angles: ['Offer or festive sale', 'New collection', 'Store experience', 'Location'],
    creatives: ['Product collection reel', 'Festive offer poster', 'Store front photo'],
    keywords: ['<product> shop near me', '<product> store in <area>'],
    negatives: ['jobs', 'online free', 'salary', 'wholesale'],
    kpis: ['Cost per store visit or call', 'Sales'],
    tips: ['Push festival and wedding seasons; start 2-3 weeks early.']
  },
  {
    key: 'b2b_manufacturing',
    label: 'B2B / Manufacturing / Wholesale',
    goals: [
      ['leads', 'Bulk order, dealer and quote (RFQ) enquiries'],
      ['traffic', 'Product catalogue pages'],
      ['awareness', 'Trade show, new product range or a new region'],
      ['appointments', 'Factory visit or sales call bookings']
    ],
    leadPath: 'Website enquiry or form; Google search for product + supplier',
    ages: [25, 60],
    interests: ['Small business', 'Manufacturing', 'Wholesale', 'Business owners', 'IndiaMART'],
    angles: ['Capacity and quality', 'Price for bulk', 'Certifications', 'Delivery across India'],
    creatives: ['Factory or product photo', 'Spec sheet card', 'Client logos'],
    keywords: ['<product> manufacturer', '<product> supplier in <city>', '<product> wholesale price'],
    negatives: ['jobs', 'retail', 'single piece', 'free', 'diy'],
    kpis: ['Cost per qualified enquiry', 'Order value'],
    tips: ['Google search beats Meta for most B2B products.']
  },
  {
    key: 'other',
    label: 'Other',
    goals: [
      ['leads', 'Enquiries with name and phone'],
      ['awareness', 'Launch or reaching many people nearby'],
      ['traffic', 'Website or page visits'],
      ['sales', 'Online orders'],
      ['appointments', 'Bookings or visits']
    ],
    leadPath: 'Instant form, WhatsApp or website, whichever the business uses to close',
    ages: [18, 55],
    interests: [],
    angles: ['Main benefit', 'Offer', 'Trust and reviews'],
    creatives: ['Real product or service photo', 'Offer card'],
    keywords: [],
    negatives: ['jobs', 'salary', 'free', 'course'],
    kpis: ['Cost per lead', 'Sales'],
    tips: []
  }
];

export const SECTORS = PLAYBOOKS.map((sector) => ({
  ...sector,
  goals: sector.goals.map(([key, when]) => ({ key, label: GOAL_LABELS[key], when }))
}));

export const SECTOR_KEYS = SECTORS.map((sector) => sector.key);

const PRODUCT_ASK = {
  real_estate: ['Which property is this ad for? Write the project, type and location.', 'Kaunsi property ka ad hai? Project, type aur location likho.', '2BHK flats in Sector 150 Noida, plots in Greater Noida, Prestige Lakeside 3BHK'],
  ecommerce: ['Which product or collection is this ad for?', 'Kaunse product ya collection ka ad hai?', 'Cotton kurtis for women, wireless earbuds, festive gift hampers'],
  it_saas: ['Which software or service is this ad for?', 'Kaunsi software ya service ka ad hai?', 'CRM for real estate brokers, website development, school ERP'],
  edtech: ['Which course or batch is this ad for?', 'Kaunse course ya batch ka ad hai?', 'NEET 2027 dropper batch, spoken English course, CA foundation classes'],
  college: ['Which course or admission is this ad for?', 'Kaunse course ya admission ka ad hai?', 'BBA admissions 2027, B.Tech CSE, MBA with placements'],
  restaurant: ['What should the ad promote: the outlet, a dish or an offer?', 'Ad kis cheez ka hai: outlet, koi dish ya offer?', 'New cafe in Indiranagar, weekend buffet, party orders'],
  hotel: ['Which property, room or package is this ad for?', 'Kaunsi property, room ya package ka ad hai?', 'Resort in Rishikesh, weekend getaway package, wedding venue'],
  healthcare: ['Which treatment or service is this ad for?', 'Kaunse treatment ya service ka ad hai?', 'Dental implants, full body checkup, IVF consultation'],
  beauty_fitness: ['Which service or membership is this ad for?', 'Kaunsi service ya membership ka ad hai?', 'Bridal makeup, hair spa offer, gym membership'],
  travel: ['Which package or destination is this ad for?', 'Kaunse package ya destination ka ad hai?', 'Kashmir 5 day package, Dubai tour, Char Dham yatra'],
  automobile: ['Which model or service is this ad for?', 'Kaunse model ya service ka ad hai?', 'New Creta on-road offer, car service at home, used cars'],
  finance: ['Which loan, policy or product is this ad for?', 'Kaunse loan, policy ya product ka ad hai?', 'Home loan, term insurance, mutual fund SIP'],
  local_services: ['Which service is this ad for?', 'Kaunsi service ka ad hai?', 'AC repair, home interiors, GST filing'],
  retail_store: ['Which store, product range or offer is this ad for?', 'Kaunse store, product range ya offer ka ad hai?', 'Furniture showroom sale, mobile store, saree collection'],
  b2b_manufacturing: ['Which product or bulk offer is this ad for?', 'Kaunse product ya bulk offer ka ad hai?', 'PVC pipes wholesale, packaging boxes, industrial valves'],
  other: ['What should the ad sell?', 'Ad kis cheez ka hai?', 'Your product or service, with the city if it is local']
};

// kinds, then: name, details, usps, offer, price, [location label, location example]
const CATALOG = {
  real_estate: {
    kinds: [['residential_project', 'Residential project'], ['commercial_project', 'Commercial project'], ['plots', 'Plots / land'], ['villa', 'Villa / independent house'], ['resale', 'Resale property'], ['rental', 'Rental / lease']],
    name: 'Prestige Lakeside 3BHK', details: '2 and 3 BHK, 1150-1650 sq ft, RERA approved, possession Dec 2027', usps: 'Near metro, clubhouse and pool, 5 min to school', offer: 'Free site visit, no pre-EMI till possession', price: '85 lakh onwards', location: ['PROJECT LOCATION', 'Sector 150, Noida']
  },
  ecommerce: {
    kinds: [['product', 'Product'], ['collection', 'Collection'], ['combo', 'Combo / bundle'], ['gift', 'Gift hamper'], ['subscription', 'Subscription box']],
    name: 'Cotton kurti set', details: 'Sizes S-XXL, 6 colours, pure cotton, machine wash', usps: 'Free shipping, COD, 7-day easy returns', offer: 'Buy 2 get 1 free', price: '₹799 (MRP ₹1,499)', location: ['DELIVERS TO', 'All India']
  },
  it_saas: {
    kinds: [['software', 'Software / app'], ['saas_plan', 'SaaS plan'], ['dev_service', 'Development service'], ['support', 'Support / AMC'], ['consulting', 'Consulting']],
    name: 'CRM for real estate brokers', details: 'Lead capture, WhatsApp follow-ups, site visit tracking, mobile app', usps: '14-day free trial, setup in one day, Hindi support', offer: '2 months free on yearly plan', price: '₹999 per user per month', location: ['SERVES', 'All India, online']
  },
  edtech: {
    kinds: [['course', 'Course'], ['batch', 'Batch'], ['test_series', 'Test series'], ['crash_course', 'Crash course'], ['one_on_one', '1-on-1 classes']],
    name: 'NEET 2027 dropper batch', details: '10 months, live + recorded classes, weekly tests, doubt sessions', usps: 'Top 100 rankers last year, IIT/AIIMS faculty', offer: 'Free demo class, early bird 20% off', price: '₹45,000 full course', location: ['CENTRE / MODE', 'Online and Kota centre']
  },
  college: {
    kinds: [['ug_course', 'UG course'], ['pg_course', 'PG course'], ['diploma', 'Diploma'], ['admission', 'Admission drive'], ['scholarship', 'Scholarship']],
    name: 'BBA admissions 2027', details: '3 years, AICTE approved, internships in 2nd year', usps: '95% placement, NAAC A+, hostel on campus', offer: 'Scholarship up to 50% on entrance score', price: '₹1.2 lakh per year', location: ['CAMPUS', 'Greater Noida campus']
  },
  restaurant: {
    kinds: [['outlet', 'Outlet / cafe'], ['dish', 'Dish / menu item'], ['combo_meal', 'Combo / thali'], ['buffet', 'Buffet'], ['catering', 'Catering / party order'], ['delivery', 'Delivery offer']],
    name: 'Weekend buffet', details: '40+ dishes, live counters, veg and non-veg', usps: 'Rooftop seating, free parking, kids zone', offer: '20% off on Swiggy/Zomato this week', price: '₹699 per person', location: ['OUTLET LOCATION', 'Indiranagar, Bengaluru']
  },
  hotel: {
    kinds: [['room', 'Room type'], ['package', 'Stay package'], ['venue', 'Wedding / event venue'], ['dining', 'Restaurant / dining'], ['spa', 'Spa / experience']],
    name: 'Weekend getaway package', details: '2 nights, breakfast and dinner, river view room', usps: 'Private beach, pool, 10 min from airport', offer: 'Stay 3 pay 2', price: '₹12,999 for 2 people', location: ['PROPERTY LOCATION', 'Rishikesh']
  },
  healthcare: {
    kinds: [['treatment', 'Treatment'], ['consultation', 'Consultation'], ['checkup', 'Health checkup package'], ['surgery', 'Surgery / procedure'], ['diagnostic', 'Lab / diagnostic test']],
    name: 'Dental implants', details: 'Single tooth and full mouth, 3D scan, done in 2 visits', usps: '15 years experience, painless, EMI available', offer: 'Free first consultation', price: '₹25,000 per implant', location: ['CLINIC LOCATION', 'Andheri West, Mumbai']
  },
  beauty_fitness: {
    kinds: [['service', 'Service'], ['package', 'Package'], ['membership', 'Membership'], ['bridal', 'Bridal / event'], ['class', 'Class / training']],
    name: 'Bridal makeup', details: 'HD and airbrush, trial session, hair styling included', usps: 'Certified artists, branded products, home visit', offer: 'Free pre-bridal facial with booking', price: '₹15,000 onwards', location: ['SALON / STUDIO', 'Rajouri Garden, Delhi']
  },
  travel: {
    kinds: [['tour_package', 'Tour package'], ['destination', 'Destination'], ['pilgrimage', 'Pilgrimage / yatra'], ['honeymoon', 'Honeymoon package'], ['visa_ticket', 'Visa / tickets']],
    name: 'Kashmir 5 day package', details: 'Srinagar, Gulmarg, Pahalgam, houseboat stay, all transfers', usps: 'Local team, 24x7 support, no hidden charges', offer: 'Early booking 10% off', price: '₹18,999 per person', location: ['DEPARTS FROM', 'Delhi']
  },
  automobile: {
    kinds: [['new_car', 'New vehicle / model'], ['used_car', 'Used vehicle'], ['service', 'Service / repair'], ['accessories', 'Accessories'], ['insurance', 'Insurance / finance']],
    name: 'New Creta on-road offer', details: 'Petrol and diesel, all variants, test drive at home', usps: 'Authorised dealer, quick delivery, exchange bonus', offer: '₹50,000 exchange bonus', price: '₹11 lakh onwards ex-showroom', location: ['SHOWROOM', 'Sector 18, Noida']
  },
  finance: {
    kinds: [['loan', 'Loan'], ['insurance', 'Insurance policy'], ['investment', 'Investment / SIP'], ['card', 'Credit card'], ['advisory', 'Tax / advisory']],
    name: 'Home loan', details: 'Up to 90% of property value, 30 year tenure, balance transfer', usps: 'Approval in 48 hours, minimal documents', offer: 'Zero processing fee this month', price: 'Interest from 8.5% p.a.', location: ['SERVES', 'Delhi NCR']
  },
  local_services: {
    kinds: [['service', 'Service'], ['repair', 'Repair'], ['installation', 'Installation'], ['amc', 'Annual contract (AMC)'], ['project', 'Project / interiors']],
    name: 'AC repair and service', details: 'Split and window AC, gas refill, all brands', usps: 'Same day visit, trained technicians, 30-day warranty', offer: 'Service at ₹399 this summer', price: '₹399 onwards', location: ['SERVICE AREA', 'South Delhi and Gurgaon']
  },
  retail_store: {
    kinds: [['store', 'Store'], ['product_range', 'Product range'], ['brand', 'Brand'], ['sale', 'Sale / offer'], ['product', 'Product']],
    name: 'Furniture showroom sale', details: 'Sofas, beds, dining sets, custom sizes', usps: 'Free delivery and fitting, 5 year warranty', offer: 'Flat 40% off till Sunday', price: 'Sofas from ₹19,999', location: ['STORE LOCATION', 'Kirti Nagar, Delhi']
  },
  b2b_manufacturing: {
    kinds: [['product', 'Product'], ['product_line', 'Product line'], ['bulk', 'Bulk / wholesale offer'], ['custom', 'Custom manufacturing'], ['dealership', 'Dealership / distribution']],
    name: 'PVC pipes wholesale', details: '20-110 mm, ISI marked, pressure rated, custom lengths', usps: 'Factory price, pan-India dispatch, GST invoice', offer: 'Extra 5% on orders above 500 units', price: 'From ₹48 per metre (MOQ 200 m)', location: ['SUPPLIES TO', 'All India']
  },
  other: {
    kinds: [['product', 'Product'], ['service', 'Service'], ['package', 'Package']],
    name: 'Your product or service', details: 'What it is, sizes or options, what is included', usps: 'Why people should choose you', offer: 'Discount or free extra', price: '₹999 onwards', location: ['LOCATION', 'Where it is or where you sell it']
  }
};

export function catalogFor(key) {
  const sector = sectorOf(key);
  const config = CATALOG[sector?.key] || CATALOG.other;
  const kinds = config.kinds.map(([kind, label]) => ({ key: kind, label }));
  if (!kinds.some((kind) => kind.key === 'other')) kinds.push({ key: 'other', label: 'Other' });
  return {
    sector: sector?.key || '',
    sectorLabel: sector?.label || '',
    kinds,
    fields: {
      name: `For example ${config.name}`,
      details: `For example ${config.details}`,
      usps: `For example ${config.usps}`,
      offer: `For example ${config.offer}`,
      price: `For example ${config.price}`,
      locationLabel: config.location[0],
      location: `For example ${config.location[1]}`
    }
  };
}

export function productAsk(key, english) {
  const [en, hi, examples] = PRODUCT_ASK[key] || ['What should the ad sell?', 'Ad kis cheez ka hai?', '2BHK flats in Noida, dental clinic, coaching classes'];
  return { question: english ? en : hi, example: `Example: ${examples}` };
}

export function sectorOf(key) {
  return SECTORS.find((sector) => sector.key === key) || null;
}

export function sectorFacts(key) {
  const sector = sectorOf(key);
  if (!sector) return [];
  return [
    `Business sector: ${sector.label}`,
    `Sector playbook (general guidance, not facts about this business; never present it as a claim):`,
    `- Possible goals, most common first (the goal depends on this campaign; use the owner's goal, never assume leads): ${sector.goals.map((goal) => `${goal.key} (${goal.when})`).join('; ')}`,
    `- Lead path: ${sector.leadPath}`,
    sector.special ? `- Meta special category that may apply: ${sector.special} (suggest only, never force)` : '',
    sector.interests.length ? `- Buyer interest ideas: ${sector.interests.join(', ')}` : '',
    `- Angles that work: ${sector.angles.join('; ')}`,
    `- Creative ideas: ${sector.creatives.join('; ')}`,
    sector.keywords.length ? `- Google keyword patterns: ${sector.keywords.join('; ')}` : '',
    `- Negative keywords: ${sector.negatives.join(', ')}`,
    `- KPIs to watch: ${sector.kpis.join(', ')}`,
    sector.tips.length ? `- Tips: ${sector.tips.join(' ')}` : ''
  ].filter(Boolean);
}
