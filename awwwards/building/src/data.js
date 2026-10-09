export const img = (id, w = 1600) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=78`;

export const projects = [
  {
    name: 'Meridyen Kule',
    shape: 'tall',
    photo: '1460574283810-2aab119d8511',
    alt: 'Aşağıdan bakışla cam ve çelik bir ofis kulesi',
    place: 'Levent, İstanbul',
    year: '2024',
    size: '218 m, 52 kat',
    area: '118.000 m²',
  },
  {
    name: 'Atlas Rezidans',
    shape: 'wide',
    photo: '1527335988388-b40ee248d80c',
    alt: 'Kule vinci yanında yükselen çelik karkas',
    place: 'Ataşehir, İstanbul',
    year: '2027',
    size: '101 m, 28 kat',
    area: '46.500 m²',
    status: 'İnşa ediliyor, %62 tamamlandı',
  },
  {
    name: 'Haliç Konutları',
    shape: 'tall',
    photo: '1520264834865-7effb972c224',
    alt: 'Beyaz gökyüzü altında brüt beton konut bloğu',
    place: 'Eyüpsultan, İstanbul',
    year: '2022',
    size: '14 kat, 412 konut',
    area: '64.000 m²',
  },
  {
    name: 'Liman Plaza',
    shape: 'wide',
    photo: '1541447271487-09612b3f49f7',
    alt: 'Bulutlu gökyüzü altında bakır tonlu bir kule ve çevresindeki yüksek yapılar',
    place: 'Bakü, Azerbaycan',
    year: '2023',
    size: '134 m, 31 kat',
    area: '72.000 m²',
  },
  {
    name: 'Kızılay Adalet Binası',
    shape: 'tall',
    photo: '1589360810891-0935e508429a',
    alt: 'Koyu renkli beton cepheli kamu binası',
    place: 'Çankaya, Ankara',
    year: '2021',
    size: '9 kat, 46 duruşma salonu',
    area: '38.000 m²',
  },
  {
    name: 'Ege Kültür Merkezi',
    shape: 'wide',
    photo: '1518871886039-9597decd52af',
    alt: 'Beyaz, kıvrımlı taşıyıcı elemanlardan oluşan bir yapı',
    place: 'Alsancak, İzmir',
    year: '2020',
    size: '1.800 kişilik salon',
    area: '21.000 m²',
  },
];

export const disciplines = [
  {
    name: 'Konut',
    text: 'Toplu konuttan rezidans kulelerine; deprem yönetmeliğinin üstünde tasarlanan taşıyıcı sistemler.',
    count: 58,
  },
  {
    name: 'Ofis ve ticari',
    text: 'Kiracı gelmeden önce çalışan binalar: LEED Gold hedefli cepheler, esnek kat planları.',
    count: 39,
  },
  {
    name: 'Kamu ve kültür',
    text: 'Adliyeler, hastaneler, konser salonları. Kalabalığı taşıyan, sessizliği koruyan yapılar.',
    count: 27,
  },
  {
    name: 'Şantiye yönetimi',
    text: 'Başka yatırımcıların projelerinde maliyet, takvim ve iş güvenliğini biz üstleniyoruz.',
    count: 18,
  },
];
