// Race maps. Each one is a simplified drawing of a real circuit (the layout is traced from memory, not surveyed),
// scaled so its length matches the real lap (1 km = 1700 world units). `points` are rough control points of the centreline.
export const TRACKS = [
  { id: 'kyalami', name: 'Kyalami Grand Prix Circuit', country: 'South Africa', km: 4.5, width: 156, theme: 'highveld',
    points: [[120,560],[300,562],[520,560],[720,556],[830,520],[866,450],[826,392],[748,372],[694,330],[704,272],[764,232],[800,172],[760,112],[682,100],[612,140],[562,200],[500,232],[430,212],[392,152],[322,122],[244,152],[214,222],[254,292],[224,352],[144,372],[94,432],[84,500]] },
  { id: 'monza', name: 'Autodromo Nazionale Monza', country: 'Italy', km: 5.79, width: 160, theme: 'forest',
    points: [[800,830],[800,660],[800,490],[800,330],[784,282],[730,252],[750,202],[704,156],[620,118],[520,106],[420,118],[332,168],[282,222],[212,232],[160,292],[148,390],[158,520],[190,604],[236,654],[204,704],[254,746],[330,790],[470,812],[600,832],[700,874]] },
  { id: 'silverstone', name: 'Silverstone Circuit', country: 'United Kingdom', km: 5.89, width: 156, theme: 'airfield',
    points: [[190,640],[370,664],[548,650],[700,604],[804,540],[846,462],[812,396],[744,366],[768,304],[722,238],[640,212],[584,252],[600,320],[536,350],[470,310],[420,244],[340,214],[260,250],[220,320],[150,350],[96,420],[110,500],[150,570]] },
  { id: 'monaco', name: 'Circuit de Monaco', country: 'Monaco', km: 3.34, width: 128, theme: 'city',
    points: [[250,520],[430,500],[560,462],[700,422],[790,382],[842,320],[802,258],[722,240],[642,262],[600,322],[522,300],[452,242],[382,202],[302,222],[242,282],[152,300],[100,362],[150,424],[222,440]] },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Belgium', km: 7.0, width: 156, theme: 'forest',
    points: [[150,240],[122,320],[178,378],[290,470],[396,530],[520,592],[650,636],[780,660],[880,630],[912,550],[870,478],[790,452],[742,396],[760,326],[700,268],[620,250],[560,190],[470,160],[380,170],[300,130],[220,160]] },
  { id: 'interlagos', name: 'Autodromo José Carlos Pace', country: 'Brazil', km: 4.31, width: 150, theme: 'tropical',
    points: [[420,600],[580,610],[720,580],[820,520],[850,440],[800,380],[720,380],[660,430],[600,420],[580,350],[630,290],[700,250],[690,180],[610,140],[520,170],[460,230],[380,250],[300,210],[240,260],[250,340],[190,410],[200,500],[290,570]] },
  { id: 'daytona', name: 'Daytona International Speedway', country: 'USA', km: 4.0, width: 230, theme: 'speedway',
    points: [[220,620],[500,640],[780,620],[900,540],[930,420],[880,300],[760,230],[500,210],[260,240],[120,330],[90,440],[120,550]] },
]
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]))

// look of each map: ground colour, run-off colour, scenery
export const THEMES = {
  highveld: { ground: '#b9a15a', ground2: '#a8914c', run: '#d9c58a', scenery: 'bush', sky: '#e9d9a0' },
  forest:   { ground: '#3f7d3a', ground2: '#36702f', run: '#b8a878', scenery: 'trees', sky: '#9fd0a0' },
  airfield: { ground: '#6aa84f', ground2: '#5e9a45', run: '#c9bd8a', scenery: 'grandstand', sky: '#b7d7a8' },
  city:     { ground: '#7d8590', ground2: '#727a85', run: '#a9aeb5', scenery: 'buildings', sky: '#9fb4c8' },
  tropical: { ground: '#2f8f4e', ground2: '#287f44', run: '#c7b27d', scenery: 'palms', sky: '#8fd0a8' },
  speedway: { ground: '#4f9a4a', ground2: '#468f42', run: '#cfcfcf', scenery: 'grandstand', sky: '#a8d6a0' },
}
