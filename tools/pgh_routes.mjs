// PGH's routes (user, 22 Nov: "Redo all bike routes on PGH. Define about five high quality ones"): a few rides worth
// doing, each laid out by its waypoints — named junctions and places — and joined by the best bike way between them
// over PGH's own graph (trails first, then quiet streets; never the wrong way down a one-way street; a way already
// ridden on the lap avoided, so a loop doesn't fold back on itself).
//
//   node tools/pgh_routes.mjs [--write] [--only <id>]
//
// Prints each route: its length, climb, the ways it rides (in order, merged by name) and its checks (closes, no
// U-turn, no way ridden twice, no wrong-way one-way). --write: the routes become routes/cities/pgh.json's "presets"
// and routes/cities/pgh-presets.json (the app's list), replacing the 48 mapped from the Pittsburgh network.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGraph, graphNetwork } from '../js/graph.js';
import { loadNetwork, makePathRoute, planCloses } from '../js/network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
// the city (user, 22 Nov: CNY, "following the guide used for PGH"): routes/cities/<id>.json; PGH by default
const CITY = args.includes('--city') ? args[args.indexOf('--city') + 1] : 'pgh';
const pghPath = resolve(root, `routes/cities/${CITY}.json`);
const json = JSON.parse(readFileSync(pghPath, 'utf8'));
let city = { edges: {} }; try { city = JSON.parse(readFileSync(resolve(root, `routes/cities/${CITY}-city.json`), 'utf8')); } catch { /* (no city data yet: no one-ways) */ }
const G = decodeGraph(json);

// ---------------------------------------------------------------- the routes
// A waypoint: { near: [lat, lon] } — the junction nearest the spot (by position, not node id: ids change when PGH
// is rebuilt); { near, on: street } — the junction on that street nearest it; { at: [street, street], near } — the
// two's junction. `prefer`: ways to favour on the way to it (by name); `avoid`: ways to keep off (by name or edge id).
const PGH_TRAILS = ['Trail', 'Three Rivers Heritage Trail', 'North Shore Trail', 'Strip District Trail', 'Eliza Furnace Trail', 'South Side Trail',
  'Station Square Trail', 'Great Allegheny Passage', 'Hot Metal Bike/Pedestrian Bridge', 'Junction Hollow Trail', 'Fort Duquesne Bridge'];
const PGH_ROUTES = [
  {
    id: 'pgh-three-rivers', name: 'Three Rivers Loop', tags: ['flat', 'trail', 'classic'],
    note: 'The Three Rivers Heritage Trail from the Point: along the Mon and over the Smithfield Street Bridge to Station Square, through the South Side to the Hot Metal Bridge, back into town on the Eliza Furnace Trail, then along the Allegheny and round the Point',
    prefer: PGH_TRAILS,
    way: [
      { near: [40.44023, -80.00700] },                                                                   // the Point (its Mon side)
      { near: [40.43219, -80.00377], prefer: ['Fort Pitt Boulevard', 'Three Rivers Heritage Trail'] },   // along the Mon, over the Smithfield Street Bridge
      { near: [40.42720, -79.96244] }, { near: [40.42971, -79.95838] },                                                          // the South Side; the Hot Metal Bridge
      { near: [40.43472, -79.99688] },                                                                   // the Eliza Furnace Trail into town
      { near: [40.44422, -80.00323] },                                                                   // through town to the Allegheny
      { near: [40.44023, -80.00700] },                                                                   // round the Point
    ],
  },
  {
    id: 'pgh-mt-washington', name: 'Mount Washington', tags: ['hilly', 'views', 'climb'],
    note: 'From Station Square along East Carson Street and up P J McArdle Roadway onto Mount Washington, along Grandview Avenue past the overlooks above the Point, over the top through Allentown and down Brosville Street to the South Side, home on its back streets',
    way: [
      { near: [40.43133, -80.00158] },                                                                   // Station Square
      { near: [40.42713, -79.98975], prefer: ['East Carson Street'] },                         // along East Carson to the roadway
      { near: [40.43536, -80.01297], prefer: ['P J McArdle Roadway'] },                        // the climb, the whole roadway
      { near: [40.43064, -80.00637], prefer: ['Grandview Avenue'] },                           // Grandview Avenue's overlooks
      { near: [40.42181, -79.99252], prefer: ['Wyoming Street', 'Bailey Avenue', 'Beltzhoover Avenue', 'East Warrington Avenue'] },   // over the top through Allentown
      { near: [40.43133, -80.00158], prefer: ['Brosville Street', 'South Brosville Street', 'Sarah Street', 'Bingham Street', 'McKean Street', 'Station Square Trail', 'Street'] },   // down Brosville Street to the South Side
    ],
  },
  {
    id: 'pgh-oakland-schenley', name: 'Oakland & Schenley Park', tags: ['hilly', 'park', 'trail'],
    note: 'From the Hot Metal Bridge along the river to Hazelwood and up Junction Hollow into Schenley Park, round Panther Hollow Lake, along Forbes Avenue past Carnegie Mellon, the Carnegie Museums and the Cathedral of Learning, then down Bates Street to the river',
    prefer: PGH_TRAILS,
    way: [
      { near: [40.42971, -79.95838] },                                                                   // the Hot Metal Bridge's north end
      { near: [40.42774, -79.94910], prefer: ['Hazelwood Trail', 'Great Allegheny Passage', 'Trail'] },
      { near: [40.44040, -79.95024], prefer: ['Junction Hollow Trail'] },                      // up Junction Hollow
      { near: [40.43863, -79.94584], prefer: ['Schenley Drive'] },                             // Schenley Park
      { near: [40.43952, -79.94335], prefer: ['Lower Panther Hollow Trail'], avoid: ['Schenley Drive'] },   // down round Panther Hollow Lake
      { near: [40.43967, -79.95237], prefer: ['Schenley Drive', 'Forbes Avenue', 'South Bouquet Street'] },   // Forbes Avenue past the museums and the Cathedral of Learning
      { near: [40.43057, -79.95971], prefer: ['Bates Street'] },                               // down Bates Street
      { near: [40.42971, -79.95838], prefer: PGH_TRAILS },
    ],
  },
  {
    id: 'pgh-north-side', name: 'North Shore & North Side', tags: ['flat', 'stadiums', 'neighbourhoods'],
    note: 'From PNC Park along the North Shore Trail past Acrisure Stadium, up Allegheny Avenue to Ridge Avenue\'s old mansions, up Arch Street beside West Park into the Mexican War Streets, and back down round Allegheny Commons to the river',
    prefer: ['North Shore Trail', 'Trail', 'Ridge Avenue', 'Federal Street'],
    way: [
      { near: [40.44926, -80.00462] },                                           // PNC Park: Federal Street at Lacock
      { near: [40.44514, -80.01673], prefer: ['North Shore Trail', 'Trail'] },   // the North Shore Trail past Acrisure Stadium
      { near: [40.44971, -80.01835], prefer: ['Allegheny Avenue'] },
      { near: [40.45198, -80.00866], prefer: ['Ridge Avenue'] },                               // Ridge Avenue's mansions
      { near: [40.45881, -80.00983], prefer: ['Arch Street'] },                                // up Arch Street beside West Park into the Mexican War Streets
      { near: [40.45552, -80.00979], prefer: ['Sherman Avenue', 'Jacksonia Street', 'Sampsonia Street'] },
      { near: [40.44926, -80.00462], prefer: ['Sherman Avenue', 'West Commons', 'East Commons', 'Federal Street', 'Sandusky Street'] },   // round Allegheny Commons
    ],
  },
  {
    id: 'pgh-strip-lawrenceville', name: 'Strip District & Lawrenceville', tags: ['flat', 'neighbourhoods', 'trail'],
    note: 'Along the Strip District Trail, up Smallman Street through the Strip and Butler Street through Lawrenceville, over the 40th Street Bridge, back down the Allegheny on the North Shore Trail past Washington\'s Landing, and over the David McCullough (16th Street) Bridge',
    prefer: ['Smallman Street', 'Butler Street', 'North Shore Trail', 'Strip District Trail', 'Trail'],
    way: [
      { near: [40.45028, -79.98889] },                                                                   // the Strip District Trail's west end, by Waterfront Drive
      { near: [40.45528, -79.98152], prefer: ['Strip District Trail'] },                       // along the Allegheny
      { near: [40.46290, -79.96695], prefer: ['Smallman Street', 'Penn Avenue'] },             // Smallman Street up the Strip, Penn Avenue to Butler
      { near: [40.46835, -79.96277], prefer: ['Butler Street', 'Trail'], avoid: ['Penn Avenue'] },                              // Butler Street, Lawrenceville
      { near: [40.46446, -79.97951], prefer: ['40th Street', '40th Street Bridge'] },          // over the 40th Street Bridge to Millvale
      { near: [40.45319, -79.99269], prefer: ['North Shore Trail', 'Trail', 'Progress Street'] },   // down the Allegheny on the North Shore Trail
      { near: [40.45028, -79.98889], prefer: ['David McCullough Bridge', '16th Street', 'Smallman Street', 'Waterfront Drive'] },   // over the David McCullough (16th Street) Bridge
    ],
  },
];

// ---------------------------------------------------------------- CNY (Camillus, Warners, Amboy: tools/city/cny.json)
const CNY_TRAILS = ['Erie Canalway Trail', 'Trail'];
const CNY_ROUTES = [
  {
    id: 'cny-erie-canal', name: 'Erie Canal Towpath', tags: ['flat', 'trail', 'classic'],
    note: 'From the Erie Canal Park on Devoe Road along the old towpath past Warners to West Sorrell Hill Road, back through Warners on Warners Road and down Newport Road',
    prefer: CNY_TRAILS,
    way: [
      { near: [43.05264, -76.30381] },                                                       // Erie Canal Park: the trail at Devoe Road
      { near: [43.07648, -76.32820], prefer: CNY_TRAILS },                                   // the towpath to Newport Road at Warners
      { near: [43.09499, -76.35938], prefer: CNY_TRAILS },                                   // …on to West Sorrell Hill Road
      { near: [43.08489, -76.32878], prefer: ['Warners Road'] },                             // back through Warners
      { near: [43.05053, -76.30594], prefer: ['Newport Road'] },                             // down Newport Road past Canal Road
      { near: [43.05264, -76.30381], prefer: ['Devoe Road'] },
    ],
  },
  {
    id: 'cny-amboy', name: 'Canal Park & Amboy', tags: ['flat', 'trail', 'neighbourhoods'],
    note: 'From Camillus village out Milton Avenue and Bennett Road to Amboy, back along the Erie Canalway Trail beside Thompson Road to the Erie Canal Park and down Newport Road',
    way: [
      { near: [43.03906, -76.30396] },                                                       // Camillus: Genesee Street at Milton Avenue
      { near: [43.05270, -76.27846], prefer: ['Milton Avenue'] },                            // Milton Avenue to Knowell and Bennett Roads
      { near: [43.06122, -76.26744], prefer: ['Bennett Road'] },                             // Bennett Road to Warners Road
      { near: [43.06337, -76.26883], prefer: ['Warners Road'] },                             // Amboy: the trail at Warners Road
      { near: [43.05264, -76.30381], prefer: CNY_TRAILS },                                   // the trail west to the Erie Canal Park
      { near: [43.05053, -76.30594], prefer: ['Devoe Road'] },
      { near: [43.03899, -76.30760], prefer: ['Newport Road'] },                             // down Newport Road into the village
      { near: [43.03906, -76.30396], prefer: ['Genesee Street'] },
    ],
  },
  {
    id: 'cny-warners-pottery', name: 'Warners & Pottery Road', tags: ['long', 'varied', 'rural'],
    note: 'From the Erie Canal Park over the Devoe Road hill, up Herman Road through the farms, down Pottery Road, back across Warners Road to Warners and home on the towpath',
    way: [
      { near: [43.05396, -76.30238] },                                                       // Erie Canal Park: Devoe Road at Van Alstine Road
      { near: [43.08320, -76.30955], prefer: ['Devoe Road'] },                               // over the Devoe Road hill
      { near: [43.10227, -76.29593], prefer: ['Herman Road'] },                              // up Herman Road
      { near: [43.07575, -76.28274], prefer: ['Pottery Road'] },                             // down Pottery Road
      { near: [43.08320, -76.30955], prefer: ['Warners Road'] },                             // Warners Road west
      { near: [43.08489, -76.32878], prefer: ['Warners Road'] },                             // …to Warners
      { near: [43.07648, -76.32820], prefer: ['Newport Road'] },
      { near: [43.05264, -76.30381], prefer: CNY_TRAILS },                                   // home on the towpath
      { near: [43.05396, -76.30238], prefer: ['Devoe Road'] },
    ],
  },
  {
    id: 'cny-howlett-hill', name: 'Howlett Hill', tags: ['hilly', 'climb', 'short'],
    note: 'From Camillus village along West Genesee Street to Howlett Hill Road, the climb to the top of Howlett Hill, and down Munro Road',
    way: [
      { near: [43.03825, -76.30276] },                                                       // Camillus: West Genesee Street at Munro Road
      { near: [43.04107, -76.27451], prefer: ['West Genesee Street'] },                      // West Genesee Street to Howlett Hill Road
      { near: [43.03012, -76.30426], prefer: ['Howlett Hill Road'] },                        // up Howlett Hill
      { near: [43.03825, -76.30276], prefer: ['Munro Road'] },                               // down Munro Road
    ],
  },
  {
    id: 'cny-camillus-hills', name: 'Camillus Hills', tags: ['hilly', 'views', 'climb'],
    note: 'From the Erie Canal Park up Scenic Drive and Rolling Meadows Way to the top at Vista Way (the highest ground in the circle), along Falling Star Way and Ike Dixon Road, over Hunt Road and down Breed Road to the canal, home on Canal Road and Newport Road',
    way: [
      { near: [43.05053, -76.30594] },                                                       // Erie Canal Park: Newport Road at Devoe Road and Scenic Drive
      { near: [43.04326, -76.31409], prefer: ['Scenic Drive'] },                             // up Scenic Drive
      { near: [43.03710, -76.32659], prefer: ['Scenic Drive'] },
      { near: [43.04188, -76.32916], prefer: ['Rolling Meadows Way'] },                      // Rolling Meadows Way to the top
      { near: [43.04360, -76.32930], prefer: ['Vista Way'] },
      { near: [43.04460, -76.33750], prefer: ['Falling Star Way'] },                         // Falling Star Way
      { near: [43.05450, -76.34555], prefer: ['Ike Dixon Road'] },                           // Ike Dixon Road north
      { near: [43.05702, -76.33643], prefer: ['Hunt Road'] },                                // Hunt Road
      { near: [43.07481, -76.33785], prefer: ['Breed Road'] },                               // down Breed Road to the canal
      { near: [43.07409, -76.32941], prefer: ['Canal Road'] },                               // Canal Road
      { near: [43.05053, -76.30594], prefer: ['Newport Road'] },                             // Newport Road home
    ],
  },
  // (user, 23 Nov: "propose several more routes" → all five built)
  {
    id: 'cny-bennetts-corners', name: 'Bennetts Corners Loop', tags: ['rural', 'varied', 'farms'],
    note: 'From the Erie Canal Park out the towpath to its west end, south down Bennetts Corners Road through the farms to Martisco, and back through Camillus village',
    way: [
      { near: [43.05264, -76.30381] },
      { near: [43.09499, -76.35938], prefer: CNY_TRAILS },
      { near: [43.08216, -76.37315], prefer: ['Warners Road', 'Bennetts Corners Road'] },
      { near: [43.01946, -76.34078], prefer: ['Bennetts Corners Road'] },
      { near: [43.03906, -76.30396], prefer: ['Genesee Street', 'West Genesee Street', 'Genesee Road'] },
      { near: [43.05264, -76.30381], prefer: ['Newport Road', 'Devoe Road'] },
    ],
  },
  {
    id: 'cny-three-climbs', name: 'Three Little Climbs', tags: ['hilly', 'climb', 'short'],
    note: 'Over the Devoe Road hill and down Van Alstine Road to the canal, then the climbs of Breed Road and Ike Dixon Road and down Scenic Drive to the park',
    way: [
      { near: [43.05053, -76.30594] },
      { near: [43.06897, -76.30174], prefer: ['Devoe Road'] },
      { near: [43.08294, -76.3164], prefer: ['Van Alstine Road', 'Devoe Road'] },
      { near: [43.07481, -76.33785], prefer: ['Canal Road', 'Warners Road', 'Newport Road'] },
      { near: [43.05702, -76.33643], prefer: ['Breed Road'] },
      { near: [43.0545, -76.34555], prefer: ['Hunt Road'] },
      { near: [43.0363, -76.33463], prefer: ['Ike Dixon Road'] },
      { near: [43.05053, -76.30594], prefer: ['Scenic Drive', 'Newport Road'] },
    ],
  },
  {
    id: 'cny-grand-tour', name: 'Camillus Grand Tour', tags: ['long', 'hilly', 'classic'],
    note: 'The whole map: from Camillus out Newport Road to the towpath, to Warners, Canton Street and Brickyard Road, the towpath west, Bennetts Corners Road south into Camillus, up Munro Road, over Howlett Hill, out to Amboy and home on the towpath',
    way: [
      { near: [43.05264, -76.30381] },
      { near: [43.07648, -76.32820], prefer: CNY_TRAILS },
      { near: [43.08555, -76.32926], prefer: ['Newport Road', 'Warners Road'] },
      { near: [43.09974, -76.31281], prefer: ['Canton Street Road'] },
      { near: [43.08896, -76.33893], prefer: ['Brickyard Road'] },
      { near: [43.09499, -76.35938], prefer: ['Warners Road', ...CNY_TRAILS] },
      { near: [43.08216, -76.37315], prefer: ['Warners Road', 'Bennetts Corners Road'] },
      { near: [43.01946, -76.34078], prefer: ['Bennetts Corners Road'] },
      { near: [43.03825, -76.30276], prefer: ['Elm Street', 'Union Street', 'Genesee Street'] },
      { near: [43.03012, -76.30426], prefer: ['Munro Road'] },
      { near: [43.04106, -76.27451], prefer: ['Howlett Hill Road'] },
      { near: [43.05270, -76.27846], prefer: ['Knowell Road', 'Milton Avenue'], avoid: ['Howlett Hill Road'] },
      { near: [43.06122, -76.26744], prefer: ['Bennett Road'] },
      { near: [43.06337, -76.26883], prefer: ['Warners Road'] },
      { near: [43.05264, -76.30381], prefer: CNY_TRAILS },
    ],
  },
  {
    id: 'cny-canal-tt', name: 'Canal Time Trial', tags: ['flat', 'trail', 'short'],
    note: 'Flat and steady: the towpath from the Erie Canal Park to Warners Road and back down Newport Road',
    prefer: CNY_TRAILS,
    way: [
      { near: [43.05264, -76.30381] },
      { near: [43.07648, -76.32820], prefer: CNY_TRAILS },
      { near: [43.05053, -76.30594], prefer: ['Newport Road'] },
      { near: [43.05264, -76.30381], prefer: ['Devoe Road'] },
    ],
  },
  {
    // (user, 24 Nov: loop B "Meadows & Old Growth" through the Camillus Forest Unique Area — tools/cny_forest.py adds
    //  its trails; starts and ends on Thompson Road so a rider can turn in from another ride. Each waypoint a trail
    //  junction, in order: up Trail #1 and #6 through the lower woods and along the field edge, the old growth on
    //  #6 / #5 (the blowdown), down the high meadow on #1, the green tunnel (#2), the north woods (#8, #4), #3 and #2 home)
    id: 'cny-camillus-forest', name: 'Camillus Forest', tags: ['trail', 'hilly', 'short', 'views'],
    note: 'From Thompson Road into the Camillus Forest Unique Area: narrow singletrack under the old sugar maples and beeches and through the tall-grass meadows, then back out to Thompson Road',
    way: [
      { near: [43.069987, -76.276865] },                                                     // Thompson Road at the Unique Area's lot
      { near: [43.069439, -76.279092] }, { near: [43.068986, -76.281314] },                 // Trail #1 into the woods
      { near: [43.064049, -76.291232], prefer: ['Camillus Forest Trail #6'], avoid: ['Camillus Forest Trail #1', 'Camillus Forest Trail #5', 'Camillus Forest Trail #7'] },   // up Trail #6 by the field edge…
      { near: [43.065602, -76.292232], prefer: ['Camillus Forest Trail #6'], avoid: ['Camillus Forest Trail #7'] },   // …to the old growth
      { near: [43.068069, -76.291702] }, { near: [43.068604, -76.290797] },                 // Trail #5 through the old growth and the blowdown
      { near: [43.067644, -76.287783] }, { near: [43.068062, -76.283542] },                 // down the high meadow on #5 and #1
      { near: [43.070299, -76.283966] },                                                     // the green tunnel (#2)
      { near: [43.072539, -76.288766] }, { near: [43.072632, -76.280513] },                 // the north woods: #8, #4
      { near: [43.071169, -76.281091] }, { near: [43.069768, -76.27899] },                  // #3 and #2 across the east meadow
      { near: [43.069439, -76.279092] }, { near: [43.069987, -76.276865] },                 // #1 back out to Thompson Road
    ],
  },
  {
    id: 'cny-martisco', name: 'Martisco & Nine Mile Creek', tags: ['creek', 'rural', 'short'],
    note: 'From Camillus village down the Nine Mile Creek valley to Martisco, up Bennetts Corners Road and over Ike Dixon Road and Scenic Drive back to the village',
    way: [
      { near: [43.03906, -76.30396] },
      { near: [43.0173, -76.3347], prefer: ['Genesee Road', 'Genesee Street', 'West Genesee Street'] },
      { near: [43.02800, -76.34400], prefer: ['Bennetts Corners Road'] },
      { near: [43.0363, -76.33463], prefer: ['Ike Dixon Road'] },
      { near: [43.03906, -76.30396], prefer: ['Scenic Drive', 'Newport Road', 'Genesee Street'] },
    ],
  },
];

// ---------------------------------------------------------------- SKAN (Skaneateles, Marcellus and the two lakes: tools/city/skan.json)
// (user, 22 Nov: the seven rides of the Project doc claude/skan-map.md, routed on OSM over the real roads; the waypoints
// follow those lines: a junction on them every 1.5 km (2.5 km on the lake loops) so the router keeps to them)
const SKAN_TRAILS = ['Charlie Major Nature Trail'];
const SKAN_ROUTES = [
  {
    id: "skan-lakeshore", name: "Skaneateles Lakeshore", tags: ["flat", "lake", "short"],
    note: "From Skaneateles village out East Lake Road along the lake to Pork Street, over to Rickard Road and home on US 20 into the village",
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.94758, -76.41762], prefer: ["Jordan Street", "East Elizabeth Street", "East Street", "Onondaga Street"], avoid: ["East Genesee Street", "West Genesee Street"] },
      { near: [42.93007, -76.40760], prefer: ["East Lake Street"] },
      { near: [42.93118, -76.37560], prefer: ["Pork Street"] },
      { near: [42.93844, -76.37409], prefer: ["Rickard Road"] },
      { near: [42.94427, -76.41599], prefer: ["Cherry Valley Turnpike"] },
      { near: [42.94583, -76.42906], prefer: ["East Genesee Street"] },
    ],
  },
  {
    id: "skan-charlie-major", name: "Charlie Major Trail & Skaneateles Falls", tags: ["trail", "creek", "rural"],
    note: "From Skaneateles down Fennell Street to the Charlie Major Nature Trail along Skaneateles Creek, through Mottville to Skaneateles Falls, back over Stump Road and the Old Seneca Turnpike",
    prefer: SKAN_TRAILS,
    way: [
      { near: [42.94658, -76.42922] },
      { near: [42.96138, -76.43958], prefer: ["Fennell Street"] },
      { near: [42.97519, -76.44513], prefer: ["Mill Road", "Charlie Major Nature Trail", "Crow Hill Road", "Railroad Street"] },
      { near: [42.99280, -76.45617], prefer: ["Railroad Street", "Sheldon Road", "Jordan Road"] },
      { near: [42.99585, -76.43993], prefer: ["School Street", "Stump Road"] },
      { near: [42.97606, -76.42766], prefer: ["Stump Road", "State Street Road"] },
      { near: [42.96365, -76.43555], prefer: ["State Street Road", "Old Seneca Turnpike"] },
      { near: [42.94658, -76.42922], prefer: ["Old Seneca Turnpike", "Jordan Road", "Jordan Street"] },
    ],
  },
  {
    id: "skan-seneca-turnpike", name: "Seneca Turnpike: Skaneateles to Marcellus", tags: ["long", "hilly", "villages"],
    note: "From Skaneateles over the hills on the Old Seneca Turnpike to Marcellus, south over Bishop Hill and home along Lawrence Road, the New Seneca Turnpike and US 20",
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.96007, -76.43449], prefer: ["Jordan Street", "Jordan Road"] },
      { near: [42.97234, -76.42728], prefer: ["Jordan Road", "Old Seneca Turnpike"] },
      { near: [42.98015, -76.39978], prefer: ["Old Seneca Turnpike"] },
      { near: [42.98130, -76.36732], prefer: ["Old Seneca Turnpike"] },
      { near: [42.98218, -76.34660], prefer: ["Old Seneca Turnpike"] },
      { near: [42.97375, -76.33984], prefer: ["New Seneca Turnpike", "West Main Street", "South Street", "South Street Road"] },
      { near: [42.95880, -76.34818], prefer: ["South Street Road", "Bishop Hill Road"] },
      { near: [42.95715, -76.37531], prefer: ["Lawrence Road", "New Seneca Turnpike"] },
      { near: [42.94552, -76.39033], prefer: ["New Seneca Turnpike", "Fisher Road"] },
      { near: [42.94427, -76.41599], prefer: ["Cherry Valley Turnpike"] },
      { near: [42.94583, -76.42906], prefer: ["East Genesee Street"] },
    ],
  },
  {
    id: "skan-marcellus-falls", name: "Marcellus Falls & Nine Mile Creek", tags: ["short", "creek", "climb"],
    note: "From Marcellus village down North Street beside Nine Mile Creek to Marcellus Falls, up Falls Road and Howlett Hill Road and back down Dublin Road",
    way: [
      { near: [42.98245, -76.34004] },
      { near: [42.99640, -76.34009], prefer: ["North Street"] },
      { near: [43.00326, -76.32997], prefer: ["North Street", "Falls Road"] },
      { near: [42.98493, -76.33196], prefer: ["Howlett Hill Road", "Dublin Road"] },
      { near: [42.98245, -76.34004], prefer: ["East Maple Street", "Limerick Street", "East Main Street"] },
    ],
  },
  {
    id: "skan-bishop-hill", name: "Bishop Hill Climb", tags: ["hilly", "climb", "rural"],
    note: "From Marcellus up South Street Road and Bishop Hill Road over the top, along Masters Road and back down Rockwell and Slate Hill Roads",
    way: [
      { near: [42.98245, -76.34004] },
      { near: [42.96849, -76.34229], prefer: ["West Main Street", "South Street", "South Street Road", "Bishop Hill Road"] },
      { near: [42.95155, -76.35204], prefer: ["Bishop Hill Road", "Lawrence Road"] },
      { near: [42.94980, -76.33332], prefer: ["Bishop Hill Road", "Masters Road"] },
      { near: [42.97304, -76.32751], prefer: ["South Street Road", "Seal Road", "Rockwell Road"] },
      { near: [42.98245, -76.34004], prefer: ["Slate Hill Road", "West Seneca Turnpike", "East Main Street"] },
    ],
  },
  {
    id: "skan-lake-loop", name: "Skaneateles Lake Loop", tags: ["long", "hilly", "lake", "classic"],
    note: "Round Skaneateles Lake: south on West Lake Road and NY 41A high above the west shore, round the south end at Glen Haven, and home along East Lake Road (NY 41) on the east shore",
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.92328, -76.43679], prefer: ["Jordan Street", "West Genesee Street", "West Lake Street", "West Lake Road"] },
      { near: [42.89539, -76.41803], prefer: ["West Lake Road"] },
      { near: [42.87234, -76.40778], prefer: ["West Lake Road"] },
      { near: [42.83983, -76.38071], prefer: ["West Lake Road", "State Highway 41A"] },
      { near: [42.82983, -76.35116], prefer: ["State Highway 41A", "NY 41A"] },
      { near: [42.79792, -76.34695], prefer: ["NY 41A"] },
      { near: [42.77219, -76.25334], prefer: ["Glen Haven Road", "Vincent Hill Road"] },
      { near: [42.80413, -76.26476], prefer: ["East Lake Road", "State Route 41"] },
      { near: [42.83796, -76.29531], prefer: ["State Route 41"] },
      { near: [42.85875, -76.33788], prefer: ["State Route 41", "East Lake Road"] },
      { near: [42.87435, -76.36406], prefer: ["East Lake Road"] },
      { near: [42.91716, -76.40051], prefer: ["East Lake Road"] },
      { near: [42.94427, -76.41599], prefer: ["East Lake Road", "East Lake Street"] },
      { near: [42.94427, -76.41599], prefer: ["East Lake Street"] },
      { near: [42.94583, -76.42906], prefer: ["East Lake Road", "East Lake Street", "East Genesee Street"] },
    ],
  },
  {
    id: "skan-otisco-loop", name: "Otisco Lake Loop", tags: ["hilly", "lake", "rural"],
    note: "From Amber at the north end of Otisco Lake down Otisco Valley Road on the east shore, round the south end at Otisco Valley, and back up the west side on Willowdale Road and NY 174",
    way: [
      { near: [42.88489, -76.29332] },
      { near: [42.85182, -76.25834], prefer: ["Otisco Valley Road"] },
      { near: [42.82829, -76.23176], prefer: ["Otisco Valley Road"] },
      { near: [42.82447, -76.25212], prefer: ["Sawmill Road", "Moon Hill Road"] },
      { near: [42.83653, -76.26584], prefer: ["Moon Hill Road", "Willowdale Road"] },
      { near: [42.86109, -76.30742], prefer: ["Willowdale Road"] },
      { near: [42.87028, -76.31904], prefer: ["Willowdale Road"] },
      { near: [42.90559, -76.31497], prefer: ["Howe Road", "Willowdale Road", "West Lake Road", "State Route 174"] },
      { near: [42.88489, -76.29332], prefer: ["Otisco Valley Road"] },
    ],
  },
  // (user, 23 Nov: "propose several more routes" → all six built)
  {
    id: 'skan-vinegar-hill', name: 'Vinegar Hill & Kingston Road', tags: ['hilly', 'creek', 'rural'],
    note: 'From Skaneateles out Jordan Road to Mottville, along Vinegar Hill Road above Skaneateles Creek, back up Kingston Road and home on State Street Road',
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.97357, -76.44225], prefer: ['Jordan Street', 'Jordan Road', 'Crow Hill Road', 'Mottville Road'] },
      { near: [42.97942, -76.44508], prefer: ['Crow Hill Road', 'Vinegar Hill Road'] },
      { near: [43.01807, -76.41985], prefer: ['Vinegar Hill Road'] },
      { near: [42.99417, -76.40413], prefer: ['Kingston Road'] },
      { near: [42.96365, -76.43555], prefer: ['State Street Road', 'Stump Road', 'Old Seneca Turnpike'], avoid: ['Jordan Road', 'Jordan Street'] },
      { near: [42.94583, -76.42906], prefer: ['State Street', 'Old Seneca Turnpike', 'Onondaga Street'], avoid: ['Jordan Street', 'Jordan Road'] },
    ],
  },
  {
    id: 'skan-south-end-climb', name: 'South End Climb: NY 41 & Nunnery Road', tags: ['hilly', 'climb', 'views'],
    note: 'From East Lake Road at the lake the long climb of NY 41 onto the high ground at the south end (about 530 m), across on Woodworth Road and down Nunnery Road to the lake (Ridge Road is a dead end in the map, so the loop keeps north of it)',
    way: [
      { near: [42.85875, -76.33788] },
      { near: [42.83951, -76.29776], prefer: ['State Route 41', 'East Lake Road'], avoid: ['Nunnery Road'] },
      { near: [42.82384, -76.27533], prefer: ['State Route 41'] },
      { near: [42.83822, -76.30111], prefer: ['Woodworth Road'] },
      { near: [42.85875, -76.33788], prefer: ['Nunnery Road'] },
    ],
  },
  {
    id: 'skan-spafford', name: 'Spafford Highlands', tags: ['hilly', 'views', 'rural'],
    note: 'The ridge between Skaneateles and Otisco Lakes: up Willow Hill Road, along Becker Road over the top and back down Willowdale Road',
    way: [
      { near: [42.87028, -76.31904] },
      { near: [42.85154, -76.31729], prefer: ['Willow Hill Road'] },
      { near: [42.83001, -76.26398], prefer: ['Becker Road'] },
      { near: [42.87028, -76.31904], prefer: ['Willowdale Road'], avoid: ['Becker Road', 'Willow Hill Road'] },
    ],
  },
  {
    id: 'skan-creek-valley', name: 'Skaneateles Creek & County Line', tags: ['creek', 'rural', 'easy'],
    note: 'From Skaneateles north on Jordan Road down the creek valley to Skaneateles Falls, across Sheldon Road and back south on County Line Road and West Lake Road',
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.97357, -76.44225], prefer: ['Jordan Street', 'Jordan Road'] },
      { near: [42.99438, -76.45745], prefer: ['Jordan Road'] },
      { near: [42.98633, -76.4616], prefer: ['Sheldon Road', 'Jordan Road'] },
      { near: [42.92328, -76.43679], prefer: ['County Line Road'] },
      { near: [42.94583, -76.42906], prefer: ['West Lake Road', 'West Lake Street', 'West Genesee Street'] },
    ],
  },
  {
    id: 'skan-limeledge', name: 'Slate Hill & Limeledge', tags: ['hilly', 'climb', 'rural'],
    note: 'From Marcellus west on Limeledge Road, down to Stump Road and back over the hills to Marcellus by Slate Hill Road',
    way: [
      { near: [42.98245, -76.34004] },
      { near: [42.98195, -76.35192], prefer: ['West Main Street', 'Old Seneca Turnpike', 'Limeledge Road'] },
      { near: [43.01904, -76.37517], prefer: ['Limeledge Road'] },
      { near: [42.98245, -76.34004], prefer: ['State Street Road', 'Forward Road', 'North Street'], avoid: ['Limeledge Road', 'Old Seneca Turnpike', 'New Seneca Turnpike'] },
    ],
  },
  {
    id: 'skan-two-lakes', name: 'Two Lakes Grand Tour', tags: ['long', 'hilly', 'lake', 'classic'],
    note: 'The longest ride: down the west shore of Skaneateles Lake, round Glen Haven, up NY 41, over Stanton Road to Otisco Lake, up its east shore to Amber, and home by Marietta and the Cherry Valley Turnpike',
    way: [
      { near: [42.94583, -76.42906] },
      { near: [42.92328, -76.43679], prefer: ['Jordan Street', 'West Genesee Street', 'West Lake Street', 'West Lake Road'] },
      { near: [42.89539, -76.41803], prefer: ['West Lake Road'] },
      { near: [42.87234, -76.40778], prefer: ['West Lake Road'] },
      { near: [42.83983, -76.38071], prefer: ['West Lake Road', 'State Highway 41A'] },
      { near: [42.82983, -76.35116], prefer: ['State Highway 41A', 'NY 41A'] },
      { near: [42.79792, -76.34695], prefer: ['NY 41A'] },
      { near: [42.77219, -76.25334], prefer: ['Glen Haven Road', 'Vincent Hill Road'] },
      { near: [42.80413, -76.26476], prefer: ['East Lake Road', 'State Route 41'] },
      { near: [42.83796, -76.29531], prefer: ['State Route 41'] },
      { near: [42.83653, -76.26584], prefer: ['Stanton Road'] },
      { near: [42.85182, -76.25834], prefer: ['Otisco Valley Road'] },
      { near: [42.88489, -76.29332], prefer: ['Otisco Valley Road'] },
      { near: [42.90257, -76.30007], prefer: ['Amber Road'] },
      { near: [42.93109, -76.33543], prefer: ['Slate Hill Road', 'Marietta Road', 'Sevier Road'] },
      { near: [42.94427, -76.41598], prefer: ['Cherry Valley Turnpike'] },
      { near: [42.94583, -76.42906], prefer: ['East Genesee Street'] },
    ],
  },
];

// ---------------------------------------------------------------- NYC (Central Park: tools/city/nyc.json)
// (user, 25 Nov: "routes that follow the paths there"; chose the Full Loop, the Lower Loop, a landmarks tour and the
// bridle path + Harlem Hill. The drives counter-clockwise, as the park rides them: up the East Drive, down the West)
const NYC_DRIVES = ['East Drive', 'West Drive', 'Center Drive', 'Terrace Drive', '102nd Street Crossing'];
const NYC_ROUTES = [
  {
    id: 'nyc-full-loop', name: 'Central Park Full Loop', tags: ['classic', 'hilly', 'loop'],
    note: 'The 6.1-mile Park Drive loop, counter-clockwise as the park rides it: from Columbus Circle past the Pond and up the East Drive by the Met and Cat Hill, round the north end over Harlem Hill, and down the West Drive past the Great Hill and Strawberry Fields',
    prefer: NYC_DRIVES, kindCost: { path: 4, bridle: 4, plaza: 4 },
    way: [
      { near: [40.76760, -73.97900], on: 'West Drive' },     // Merchants' Gate, Columbus Circle
      { near: [40.77160, -73.96960], on: 'East Drive' },      // the East Drive at 72nd St (by the Center Drive past the Pond)
      { near: [40.77950, -73.96290], kind: 'drive' },         // Cat Hill, by the Met
      { near: [40.78700, -73.95750], kind: 'drive' },         // Engineers' Gate (90th St)
      { near: [40.79500, -73.95300], kind: 'drive' },         // 106th St, by the Meer
      { near: [40.79875, -73.95860], kind: 'drive' },         // Harlem Hill
      { near: [40.79100, -73.96350], kind: 'drive' },         // the West Drive at 96th St
      { near: [40.76760, -73.97900], on: 'West Drive' },      // past Strawberry Fields to Columbus Circle
    ],
  },
  {
    id: 'nyc-lower-loop', name: 'Lower Loop', tags: ['flat', 'short', 'loop'],
    note: 'The south end in 1.7 miles: up the East Drive past the Wollman Rink and the Mall, across the park on the 72nd Street cross drive above Bethesda Terrace, and down the West Drive past Sheep Meadow to Columbus Circle',
    prefer: NYC_DRIVES, kindCost: { path: 4, bridle: 4, plaza: 4 },
    way: [
      { near: [40.76760, -73.97900], on: 'West Drive' },
      { near: [40.77160, -73.96960], on: 'East Drive' },
      { near: [40.77410, -73.97180], on: 'Terrace Drive' },   // above Bethesda Terrace
      { near: [40.77620, -73.97570], on: 'West Drive' },      // the West Drive at 72nd St
      { near: [40.76760, -73.97900], on: 'West Drive' },
    ],
  },
  {
    id: 'nyc-landmarks', name: 'Central Park Landmarks', tags: ['scenic', 'paths', 'easy'],
    note: 'The park on its paths: the Mall and Literary Walk to Bethesda Terrace and the fountain, along the Lake to Bow Bridge, past Belvedere Castle and Turtle Pond to the Great Lawn, round the Reservoir, up to the Conservatory Garden and Harlem Meer, and home down the West Drive',
    way: [
      { near: [40.76760, -73.97900], on: 'West Drive' },
      { near: [40.77010, -73.97370] },                        // the Mall's foot (Literary Walk)
      { near: [40.77390, -73.97080] },                        // Bethesda Terrace
      { near: [40.77560, -73.97170] },                        // Bow Bridge
      { near: [40.77920, -73.96900] },                        // Belvedere Castle / Turtle Pond
      { near: [40.78250, -73.96780] },                        // the Great Lawn's north end
      { near: [40.78560, -73.96650] },                        // the Reservoir (south-west)
      { near: [40.79040, -73.95810] },                        // the Reservoir (north-east)
      { near: [40.79380, -73.95230] },                        // the Conservatory Garden
      { near: [40.79680, -73.95330] },                        // Harlem Meer
      { near: [40.79760, -73.95980] },                        // Harlem Hill
      { near: [40.78100, -73.97130], on: 'West Drive' },
      { near: [40.76760, -73.97900], on: 'West Drive' },
    ],
  },
  {
    id: 'nyc-bridle-harlem-hill', name: 'Bridle Path & Harlem Hill', tags: ['hilly', 'gravel', 'loop'],
    note: 'Round the Reservoir on the bridle path\'s fine gravel, then the north end the hard way: up the East Drive to the Meer and over Harlem Hill, the park\'s biggest climb, and down the West Drive back to the Reservoir',
    kindCost: { path: 3 },
    way: [
      { near: [40.78400, -73.96300], kind: 'bridle' },        // the bridle path at the Reservoir's south end
      { near: [40.78852, -73.96462], kind: 'bridle' },        // its west side
      { near: [40.79144, -73.95830], kind: 'bridle' },        // its north end
      { near: [40.78727, -73.95744], kind: 'drive' },         // Engineers' Gate, onto the East Drive
      { near: [40.79500, -73.95300], kind: 'drive' },         // the Meer
      { near: [40.79875, -73.95860], kind: 'drive' },         // Harlem Hill
      { near: [40.79100, -73.96350], kind: 'drive' },         // the West Drive at 96th St
      { near: [40.78400, -73.96300], kind: 'bridle' },
    ],
  },
];

// (a map's own rides as data, tools/city/<id>-routes.json { trails, routes } — Out West's, 26 Nov 2026: the newer maps
//  keep their rides beside their config instead of here)
const ROUTE_FILE = resolve(root, `tools/city/${CITY}-routes.json`);
const FILE_ROUTES = existsSync(ROUTE_FILE) ? JSON.parse(readFileSync(ROUTE_FILE, 'utf8')) : null;
const TRAILS = FILE_ROUTES ? FILE_ROUTES.trails || [] : CITY === 'cny' ? CNY_TRAILS : CITY === 'skan' ? SKAN_TRAILS : CITY === 'nyc' ? [] : PGH_TRAILS;
const ROUTES = FILE_ROUTES ? FILE_ROUTES.routes : CITY === 'cny' ? CNY_ROUTES : CITY === 'skan' ? SKAN_ROUTES : CITY === 'nyc' ? NYC_ROUTES : CITY === 'pgh' ? PGH_ROUTES : [];

// ---------------------------------------------------------------- the graph as a router
const M_LAT = 111320, mLon = M_LAT * Math.cos(json.origin.lat * Math.PI / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * mLon);
const arms = new Map();   // node → [{ e, dir }] (dir 1: from the node along the edge)
for (const e of G.edges) {
  if (!arms.has(e.from)) arms.set(e.from, []); if (!arms.has(e.to)) arms.set(e.to, []);
  arms.get(e.from).push({ e, dir: 1 }); arms.get(e.to).push({ e, dir: -1 });
}
const lenOf = (e) => e.n * 10;
const ow = (e) => city.edges?.[e.id]?.ow || 0;   // 1: only along the edge; -1: only against it
const nodeLL = (id) => { const n = G.nodes.get(id); return [n.lat, n.lon]; };
const named = (id, name) => (arms.get(id) || []).some(({ e }) => e.name === name);
const KIND = { path: 0.8, residential: 1, tertiary: 1.05, secondary: 1.25, primary: 1.6, alley: 1.6, plaza: 1.3, drive: 0.9, bridle: 0.85 };   // (NYC: the park drives, the bridle path)

function snap(wp) {
  if (typeof wp === 'string') return wp;
  if (wp.node) return wp.node;
  let best = null;
  for (const [id] of arms) {
    if (wp.at && !(named(id, wp.at[0]) && named(id, wp.at[1]))) continue;
    if (wp.on && !named(id, wp.on)) continue;
    if (wp.kind && !(arms.get(id) || []).some(({ e }) => e.kind === wp.kind)) continue;   // (NYC: a junction on the Park Drive)
    const d = wp.near ? dist(nodeLL(id), wp.near) : 0;
    if (!best || d < best.d) best = { id, d };
  }
  if (!best) throw new Error(`no junction for ${JSON.stringify(wp)}`);
  if (best.d > 40) console.warn(`  (waypoint ${JSON.stringify(wp)}: ${Math.round(best.d)} m off)`);
  return best.id;
}

/** The heading (radians) of edge e leaving / arriving at its ends, ridden in direction dir. */
function heading(e, dir, atEnd) {
  const lat = e.lat, lon = e.lon, n = e.n, k = Math.min(n, 3);
  let i0, i1;
  if (dir > 0) { if (atEnd) { i0 = n - k; i1 = n; } else { i0 = 0; i1 = k; } }
  else { if (atEnd) { i0 = k; i1 = 0; } else { i0 = n; i1 = n - k; } }
  return Math.atan2((lat[i1] - lat[i0]) * M_LAT, (lon[i1] - lon[i0]) * mLon);
}
/** A turn's cost (m): straight on free, a bend a little, a right angle more, a hairpin a lot — so a route keeps to
 *  a street rather than zigzagging through a grid. */
function turnCost(a, b) {
  let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
  return d < 0.5 ? 0 : d < 1.2 ? 35 : d < 2.2 ? 80 : 400;
}

/** The best way from a to b: Dijkstra over (edge, direction) — the cost of each way by its kind, its climb, whether
 *  it's preferred or avoided, whether this lap has ridden it already, and the turn onto it. → [{ e, dir }] */
function route(a, b, used, prefer = [], avoid = [], arriveHeading = null, kindCost = {}) {
  const D = new Map(), prev = new Map(), Q = [];
  const push = (key, d, from, step) => { if (d < (D.get(key) ?? Infinity)) { D.set(key, d); prev.set(key, { from, step }); Q.push([d, key]); } };
  const stepCost = (e, dir) => {
    let c = lenOf(e) * (KIND[e.kind] ?? 1.2) * (kindCost[e.kind] ?? 1);   // (a route's own kind costs: NYC's loops keep to the drives)
    const up = Math.max(0, dir > 0 ? e.ele[e.n] - e.ele[0] : e.ele[0] - e.ele[e.n]); c += up * 4;
    if (prefer.includes(e.name)) c *= 0.75;
    if (avoid.includes(e.name)) c *= 8;
    if (avoid.includes(e.id)) c += 1e7;   // (an edge by id: kept off altogether)
    if (used.has(e.id)) c *= 6;
    return c;
  };
  const okDir = (e, dir) => { const o = ow(e); return !(o && o !== dir && e.kind !== 'path'); };
  for (const { e, dir } of arms.get(a) || []) if (okDir(e, dir)) push(`${e.id}${dir}`, stepCost(e, dir) + (arriveHeading == null ? 0 : turnCost(arriveHeading, heading(e, dir, false))), null, { e, dir });
  const done = new Set(); let goal = null;
  while (Q.length) {
    let k = 0; for (let q = 1; q < Q.length; q++) if (Q[q][0] < Q[k][0]) k = q;
    const [d, key] = Q.splice(k, 1)[0];
    if (done.has(key)) continue; done.add(key);
    const { step } = prev.get(key), v = step.dir > 0 ? step.e.to : step.e.from;
    if (v === b) { goal = key; break; }
    const h = heading(step.e, step.dir, true);
    for (const { e, dir } of arms.get(v) || []) {
      if (e === step.e || !okDir(e, dir)) continue;
      push(`${e.id}${dir}`, d + stepCost(e, dir) + turnCost(h, heading(e, dir, false)), key, { e, dir });
    }
  }
  if (!goal) throw new Error(`no way from ${a} to ${b}`);
  const out = []; for (let key = goal; key; key = prev.get(key).from) out.unshift(prev.get(key).step);
  return out;
}

// ---------------------------------------------------------------- build, check, report
const { base, network } = graphNetwork(json);
const net = loadNetwork(network, base);
if (args.includes('--find')) {   // --find <street> [<street>]: the junctions on it (and the other), with where they are
  const [a, b] = args.slice(args.indexOf('--find') + 1).filter((x) => !x.startsWith('--'));
  for (const [id] of arms) if (named(id, a) && (!b || named(id, b))) console.log(id, nodeLL(id).map((v) => v.toFixed(5)).join(', '), [...new Set(arms.get(id).map(({ e }) => e.name))].join(' / '));
  process.exit(0);
}
const results = [];
for (const R of ROUTES) {
  if (only && R.id !== only) continue;
  const ids = R.way.map(snap), used = new Set(), steps = [];
  if (args.includes('--wp')) R.way.forEach((w, k) => console.log(`  wp${k} ${ids[k]} ${nodeLL(ids[k]).map((v) => v.toFixed(5))} ${[...new Set(arms.get(ids[k]).map(({ e }) => e.name))].join(' / ')} (${Math.round(dist(nodeLL(ids[k]), w?.near || nodeLL(ids[k])))} m)`));
  for (let k = 0; k + 1 < ids.length; k++) {
    if (ids[k] === ids[k + 1]) continue;
    const last = steps[steps.length - 1];
    const leg = route(ids[k], ids[k + 1], used, (typeof R.way[k + 1] === 'object' && R.way[k + 1].prefer) || R.prefer || [], (typeof R.way[k + 1] === 'object' && R.way[k + 1].avoid) || R.avoid || [], last ? heading(last.e, last.dir, true) : null, R.kindCost || {});
    if (args.includes('--legs')) console.log(`  leg ${ids[k]}→${ids[k + 1]}: ${leg.map((x) => `${x.e.name}(${x.e.id}${x.dir > 0 ? '+' : '-'})`).join(' ')}`);
    for (const s of leg) { steps.push(s); used.add(s.e.id); }
  }
  // tidy: a step straight back along the way just ridden (a spur out and back) is cut out
  // (R.outAndBack — a climb or a canyon ridden up and back the same road: its turnaround stays, and the road twice is the ride)
  if (!R.outAndBack) for (let k = 0; k + 1 < steps.length; ) { if (steps[k].e.id === steps[k + 1].e.id) { steps.splice(k, 2); k = Math.max(0, k - 1); } else k++; }
  const keys = steps.map((s) => `${s.e.id}${s.dir > 0 ? '+' : '-'}`);
  const preset = { id: R.id, name: R.name, path: keys, tags: R.tags, note: R.note, ...(R.outAndBack ? { outAndBack: true } : {}) };
  const r = makePathRoute(net, preset);
  preset.lengthM = Math.round(r.lapM); preset.climbM = Math.round(r.lapClimbM);
  // checks
  const issues = [];
  if (!planCloses(net, keys)) issues.push('does not close');
  const seen = new Map(); for (const s of steps) seen.set(s.e.id, (seen.get(s.e.id) || 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => `${G.byId.get(id).name || id}`);
  if (twice.length && !R.outAndBack) issues.push(`ridden twice: ${[...new Set(twice)].join(', ')}`);
  let turns = 0; for (let k = 0; k < steps.length; k++) { const s = steps[k], n = steps[(k + 1) % steps.length]; if (s.e.id === n.e.id) { turns++; if (!R.outAndBack) issues.push(`U-turn on ${s.e.name}`); } }
  if (R.outAndBack && turns > 2) issues.push(`${turns} turnarounds (an out-and-back has its one, and its start)`);
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k], n = steps[(k + 1) % steps.length];
    let d = Math.abs(heading(n.e, n.dir, false) - heading(s.e, s.dir, true)); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 2.6 && s.e.id !== n.e.id && !R.outAndBack) issues.push(`hairpin ${s.e.name || s.e.id} → ${n.e.name || n.e.id}`);
  }
  const wrong = steps.filter((s) => { const o = ow(s.e); return o && o !== s.dir && s.e.kind !== 'path'; });
  if (wrong.length) issues.push(`wrong way: ${wrong.map((s) => s.e.name).join(', ')}`);
  // the ways, merged by name
  const legs = [];
  for (const s of steps) { const nm = s.e.name || `(${s.e.kind})`, l = lenOf(s.e); if (legs.length && legs[legs.length - 1][0] === nm) legs[legs.length - 1][1] += l; else legs.push([nm, l]); }
  const kinds = {}; for (const s of steps) kinds[s.e.kind] = (kinds[s.e.kind] || 0) + lenOf(s.e);
  console.log(`\n${R.name} (${R.id}): ${(preset.lengthM / 1000).toFixed(1)} km, ${preset.climbM} m climb, ${steps.length} steps, ${legs.length} legs`);
  console.log(`  by kind: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', ')}`);
  console.log(`  ${legs.map(([n, l]) => `${n} ${Math.round(l)}`).join(' → ')}`);
  console.log(`  checks: ${issues.length ? issues.join('; ') : 'ok'}`);
  results.push({ preset, issues });
}

if (args.includes('--write')) {
  if (only) throw new Error('--write builds every route: leave out --only');
  json.presets = results.map((x) => x.preset);
  writeFileSync(pghPath, JSON.stringify(json));
  writeFileSync(resolve(root, `routes/cities/${CITY}-presets.json`), JSON.stringify(results.map(({ preset: p }) => ({ id: p.id, name: p.name, tags: p.tags, note: p.note, lengthM: p.lengthM, climbM: p.climbM })), null, 1));
  console.log(`\nwrote ${results.length} routes → routes/cities/${CITY}.json (presets), routes/cities/${CITY}-presets.json`);
}
