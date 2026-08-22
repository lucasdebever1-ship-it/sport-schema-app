/* data.js - alle vaste gegevens. De app verzint hier niets bij. */

const GOAL_TYPES = [
  { id: 'kwarttriathlon', label: 'Kwarttriathlon' },
  { id: 'halve-triathlon', label: 'Halve triathlon' },
  { id: '10km', label: '10 km hardlopen' },
  { id: 'geen', label: 'Geen doel' }
];

/* Vanaf 10 weken of minder tot de datum schakelt de app naar de triathlonfase. */
const TRIATHLON_WEEKS = 10;

const WARMUP = [
  { name: 'Armcirkels voor- en achteruit', detail: '30 seconden' },
  { name: 'Cat-cow', detail: '8 herhalingen' },
  { name: "World's greatest stretch", detail: '5 per kant' },
  { name: 'Beenzwaaien voor- en achteruit', detail: '10 per been' },
  { name: 'Beenzwaaien zijwaarts', detail: '10 per been' },
  { name: 'Bodyweight squats', detail: '10 stuks' }
];

/* Grote oefeningen gaan met 5 kg omhoog, de rest met 2,5 kg. */
const BIG_LIFTS = [
  'Bench press', 'Lat pulldown', 'Leg press', 'Romanian deadlift', 'Hip thrust', 'Dumbbell shoulder press'
];

/* Lange namen en korte namen zijn dezelfde oefening, zo deelt de app de geschiedenis. */
const EXERCISE_ALIAS = {
  'Row met twee handles, horizontale grip': 'Row met twee handles',
  'Machine row, verticale grip': 'Machine row',
  'Preacher curl met stang': 'Preacher curl',
  'Hammer curl met touw': 'Hammer curl',
  'Reverse curl met recht stangetje': 'Reverse curl',
  'Staande calf raise': 'Calf raise'
};

const SCHEMA_KRACHT = {
  1: {
    id: 'kracht-pull', title: 'Pull', type: 'gym',
    exercises: [
      { name: 'Pull-up', sets: 2, warmupOnly: true },
      { name: 'Lat pulldown', sets: 4, min: 5, max: 8 },
      { name: 'Row met twee handles, horizontale grip', sets: 3, min: 8, max: 12 },
      { name: 'Machine row, verticale grip', sets: 3, min: 8, max: 12 },
      { name: 'Preacher curl met stang', sets: 3, min: 8, max: 12 },
      { name: 'Hammer curl met touw', sets: 2, min: 10, max: 15 },
      { name: 'Reverse curl met recht stangetje', sets: 2, min: 10, max: 15 }
    ]
  },
  3: {
    id: 'kracht-benen', title: 'Benen', type: 'gym',
    startNote: 'Techniek leren. Hou het licht.',
    exercises: [
      { name: 'Leg press', sets: 4, min: 8, max: 12 },
      { name: 'Romanian deadlift', sets: 3, min: 8, max: 12 },
      { name: 'Leg extension', sets: 3, min: 10, max: 15 },
      { name: 'Leg curl', sets: 3, min: 10, max: 15 },
      { name: 'Hip thrust', sets: 3, min: 10, max: 15 },
      { name: 'Staande calf raise', sets: 3, min: 12, max: 20 }
    ]
  },
  5: {
    id: 'kracht-push', title: 'Push', type: 'gym',
    exercises: [
      { name: 'Bench press', sets: 4, min: 5, max: 8 },
      { name: 'Incline smith press', sets: 3, min: 8, max: 12 },
      { name: 'Pec fly', sets: 3, min: 10, max: 15 },
      { name: 'Dumbbell shoulder press', sets: 3, min: 8, max: 12 },
      { name: 'Lateral raise', sets: 3, min: 12, max: 20 },
      { name: 'Rear delt cable pull', sets: 3, min: 15, max: 20 },
      { name: 'Overhead rope extension', sets: 3, min: 10, max: 15 },
      { name: 'V-bar pushdown', sets: 3, min: 10, max: 15 }
    ]
  },
  0: {
    id: 'kracht-upper', title: 'Upper mix', subtitle: 'lichter', type: 'gym',
    exercises: [
      { name: 'Lat pulldown', sets: 3, min: 8, max: 12 },
      { name: 'Incline smith press', sets: 3, min: 10, max: 15 },
      { name: 'Machine row', sets: 3, min: 12, max: 15 },
      { name: 'Lateral raise', sets: 3, min: 15, max: 20 },
      { name: 'Preacher curl', sets: 2, min: 10, max: 15 },
      { name: 'V-bar pushdown', sets: 2, min: 10, max: 15 }
    ]
  }
};

const SCHEMA_TRIATHLON = {
  1: {
    id: 'tri-pull', title: 'Gym onderhoud pull', type: 'gym',
    exercises: [
      { name: 'Lat pulldown', sets: 3, min: 6, max: 10 },
      { name: 'Machine row', sets: 3, min: 8, max: 12 },
      { name: 'Preacher curl', sets: 2, min: 8, max: 12 },
      { name: 'Romanian deadlift', sets: 3, min: 8, max: 12 }
    ]
  },
  3: {
    id: 'tri-loop', title: 'Hardlopen', type: 'cardio', sport: 'hardlopen',
    hint: 'Rustige duurloop, op een tempo waarbij je nog kunt praten.',
    blocks: [ { from: 1, to: 3, km: 5 }, { from: 4, to: 7, km: 7 }, { from: 8, to: 10, km: 9 } ]
  },
  5: {
    id: 'tri-push', title: 'Gym onderhoud push', type: 'gym',
    exercises: [
      { name: 'Bench press', sets: 3, min: 6, max: 10 },
      { name: 'Dumbbell shoulder press', sets: 3, min: 8, max: 12 },
      { name: 'V-bar pushdown', sets: 2, min: 10, max: 15 },
      { name: 'Leg press', sets: 3, min: 8, max: 12 }
    ]
  },
  0: {
    id: 'tri-fiets', title: 'Lange fietstraining', type: 'cardio', sport: 'fietsen',
    hint: 'Rustig tempo, blijf de hele rit comfortabel.',
    blocks: [ { from: 1, to: 3, km: 25 }, { from: 4, to: 7, km: 35 }, { from: 8, to: 10, km: 45 } ]
  }
};

const SWIM_TASK = { title: 'Zwemmen', detail: '20 tot 30 minuten baantjes, plan het wanneer het uitkomt.' };

const MOBILITY = [
  {
    id: 'heupen-benen', title: 'Heupen en benen', seconds: 45, perSide: true,
    exercises: ['Couch stretch', '90/90 heupdraai', 'Hamstring stretch zittend', 'Kuit tegen de muur', 'Duif (pigeon)']
  },
  {
    id: 'bovenrug-schouders', title: 'Bovenrug en schouders', seconds: 45, perSide: true,
    exercises: ['Thoracale draai op handen en knieen', 'Deurpost borststretch', 'Lat stretch aan een rek', 'Nekstretch zijwaarts']
  }
];

const MOBILITY_WHY = 'Van al dat voorovergebogen staan bij hockey trekken je heupen en bovenrug dicht.';

const TRIATHLON_INTRO =
  'Spiermassa en uithoudingsvermogen tegelijk opbouwen gaat niet. Vanaf nu houdt de gym je kracht op peil ' +
  'en gaat de rest van je energie naar zwemmen, fietsen en hardlopen.';

const DAY_NAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const DAY_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTH_NAMES = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

const HOCKEY_DAYS = { 2: 'Hockeytraining', 4: 'Hockeytraining', 6: 'Wedstrijd' };

/* Uitleg per oefening: welke spier, waar je op let, en de fout die je snel maakt. */
const EXERCISE_INFO = {
  'Pull-up': {
    spier: 'Je brede rugspier en je biceps.',
    techniek: 'Hang eerst helemaal uit, trek dan je schouderbladen omlaag en pas daarna je ellebogen naar beneden.',
    fout: 'Zwaaien met je benen om jezelf omhoog te slingeren.'
  },
  'Lat pulldown': {
    spier: 'Je brede rugspier, de spier die je rug breed maakt.',
    techniek: 'Borst omhoog, trek de stang naar je bovenste ribben en laat hem gecontroleerd terug.',
    fout: 'Ver naar achteren hangen zodat het een roeibeweging wordt.'
  },
  'Row met twee handles': {
    spier: 'Het midden van je rug, tussen je schouderbladen.',
    techniek: 'Rug recht, trek je ellebogen naar achteren en knijp je schouderbladen even samen.',
    fout: 'Met je onderrug meebewegen in plaats van alleen met je armen trekken.'
  },
  'Machine row': {
    spier: 'Je rugspieren, vooral het deel bij je schouderbladen.',
    techniek: 'Borst tegen het kussen, trek tot je ellebogen voorbij je romp zijn.',
    fout: 'Alleen met je armen trekken en je schouderbladen stil houden.'
  },
  'Preacher curl': {
    spier: 'Je biceps, vooral het onderste stuk.',
    techniek: 'Bovenarm plat op het kussen, laat gecontroleerd zakken tot je arm bijna gestrekt is.',
    fout: 'Het gewicht laten vallen op de weg naar beneden.'
  },
  'Hammer curl': {
    spier: 'Je biceps en de spier eronder die je arm dikker maakt.',
    techniek: 'Duimen naar boven, ellebogen langs je lichaam houden.',
    fout: 'Met je bovenlichaam meezwaaien om het gewicht omhoog te krijgen.'
  },
  'Reverse curl': {
    spier: 'Je onderarm en de spier bovenop je onderarm.',
    techniek: 'Handpalmen naar beneden, rustig omhoog en rustig omlaag met licht gewicht.',
    fout: 'Te zwaar pakken waardoor je polsen knikken.'
  },
  'Leg press': {
    spier: 'Je bovenbenen en je billen.',
    techniek: 'Voeten op schouderbreedte, zak tot je knieen ongeveer 90 graden zijn, druk door je hielen.',
    fout: 'Je onderrug van het kussen laten komen door te diep te zakken.'
  },
  'Romanian deadlift': {
    spier: 'Je hamstrings, de achterkant van je bovenbeen, en je billen.',
    techniek: 'Knieen licht gebogen, duw je heupen naar achteren en hou de stang dicht tegen je benen.',
    fout: 'Je rug rond maken in plaats van je heupen naar achteren duwen.'
  },
  'Leg extension': {
    spier: 'De voorkant van je bovenbeen.',
    techniek: 'Strek rustig helemaal door en hou boven even een halve tel vast.',
    fout: 'Zo hard omhoog knallen dat je knieen een klap krijgen.'
  },
  'Leg curl': {
    spier: 'Je hamstrings, de achterkant van je bovenbeen.',
    techniek: 'Heupen tegen het kussen, buig rustig en laat langzaam terug.',
    fout: 'Je billen omhoog laten komen om meer gewicht te halen.'
  },
  'Hip thrust': {
    spier: 'Je billen.',
    techniek: 'Rug op het bankje, kin naar je borst, duw omhoog tot je romp recht ligt en knijp je billen aan.',
    fout: 'Doorbuigen in je onderrug in plaats van je billen aanspannen.'
  },
  'Calf raise': {
    spier: 'Je kuiten.',
    techniek: 'Laat je hielen eerst helemaal zakken en kom dan zo hoog mogelijk op je tenen.',
    fout: 'Kleine snelle stuitertjes maken zonder volledige beweging.'
  },
  'Bench press': {
    spier: 'Je borst, je voorste schouder en je triceps.',
    techniek: 'Schouderbladen naar elkaar, voeten plat op de grond, stang naar het midden van je borst.',
    fout: 'De stang laten stuiteren op je borst.'
  },
  'Incline smith press': {
    spier: 'Het bovenste deel van je borst.',
    techniek: 'Bankje op ongeveer 30 graden, laat de stang naar je sleutelbeen zakken.',
    fout: 'Het bankje te steil zetten, dan doen je schouders bijna al het werk.'
  },
  'Pec fly': {
    spier: 'Je borst.',
    techniek: 'Kleine buiging in je ellebogen vasthouden en de beweging maken met je bovenarmen.',
    fout: 'Je armen strekken en buigen zodat het een drukbeweging wordt.'
  },
  'Dumbbell shoulder press': {
    spier: 'Je schouders, vooral de voorkant.',
    techniek: 'Onderarmen recht onder de dumbbells, druk omhoog zonder je rug door te buigen.',
    fout: 'Zo ver doorbuigen in je onderrug dat het een schuine bench press wordt.'
  },
  'Lateral raise': {
    spier: 'De zijkant van je schouder, dat maakt je schouders breder.',
    techniek: 'Licht gewicht, til tot schouderhoogte met je ellebogen iets gebogen.',
    fout: 'Het gewicht omhoog zwaaien met je hele lichaam.'
  },
  'Rear delt cable pull': {
    spier: 'De achterkant van je schouder.',
    techniek: 'Trek breed naar buiten en denk aan je schouderbladen die naar elkaar gaan.',
    fout: 'Te zwaar pakken waardoor je rug het overneemt.'
  },
  'Overhead rope extension': {
    spier: 'Je triceps, vooral de lange kop aan de achterkant van je bovenarm.',
    techniek: 'Ellebogen naast je hoofd houden en alleen je onderarmen bewegen.',
    fout: 'Je ellebogen naar buiten laten waaieren.'
  },
  'V-bar pushdown': {
    spier: 'Je triceps.',
    techniek: 'Ellebogen langs je lichaam, duw tot je armen helemaal gestrekt zijn.',
    fout: 'Voorover leunen en met je lichaamsgewicht duwen.'
  }
};
