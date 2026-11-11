/**
 * Editorial content for the public camouflage site.
 *
 * Everything here is fictional, generic lifestyle writing. It must never mention
 * anything technical about the software it fronts (see siteCamouflage tests).
 */

export interface Bilingual {
    zh: string;
    en: string;
}

export interface BilingualParagraphs {
    zh: string[];
    en: string[];
}

export type ArtVariant = 'dusk' | 'window' | 'street' | 'still' | 'garden' | 'night';

export interface ArtSpec {
    variant: ArtVariant;
    palette: [string, string, string, string];
}

export interface EventDetails {
    when: Bilingual;
    venue: Bilingual;
    price: Bilingual;
}

export interface CamouflageArticle {
    slug: string;
    section: Bilingual;
    title: Bilingual;
    dek: Bilingual;
    body: BilingualParagraphs;
    author: Bilingual;
    minutes: number;
    tags: Bilingual[];
    caption: Bilingual;
    art: ArtSpec;
    event?: EventDetails;
}

export interface CamouflageSiteContent {
    articleBase: string;
    tagline: Bilingual;
    kicker: Bilingual;
    sections: Bilingual[];
    about: BilingualParagraphs;
    aboutTitle: Bilingual;
    colophon: Bilingual;
    articles: CamouflageArticle[];
    /** Gaps (in days) between consecutive posts, newest first. */
    cadence: number[];
}

const t = (zh: string, en: string): Bilingual => ({ zh, en });

const MAGAZINE: CamouflageSiteContent = {
    articleBase: '/stories',
    tagline: t('关于街区、餐桌与日常美学的城市周刊', 'A weekly on neighborhoods, tables and everyday design'),
    kicker: t('城市漫游志', 'The City Walker'),
    sections: [t('街区', 'Neighborhoods'), t('餐桌', 'Tables'), t('展览', 'Exhibitions'), t('阅读', 'Reading')],
    aboutTitle: t('关于我们', 'About us'),
    about: {
        zh: [
            '我们是一个很小的编辑部，三位编辑、两位摄影师，以及一群愿意在周末早起的投稿人。每周我们挑一条街、一张餐桌或一间展厅，把它写得足够具体，让你下次路过时能认出来。',
            '这里没有广告位，也不接受付费推荐。文中出现的店铺与场馆都由编辑自费探访，价格与开放时间以发稿当周为准。',
            '如果你发现了值得记录的角落，欢迎写信告诉我们。我们会认真读每一封来信，但无法逐一回复，请见谅。',
        ],
        en: [
            'We are a very small desk: three editors, two photographers and a handful of contributors who are happy to get up early on weekends. Each week we pick one street, one table or one gallery and write about it specifically enough that you will recognise it next time you pass.',
            'There are no ad slots here and we do not accept paid placements. Every shop and venue in these pages was visited at our own expense; prices and opening hours are correct for the week of publication.',
            'If you have found a corner worth writing about, send us a letter. We read every one, though we cannot always reply.',
        ],
    },
    colophon: t('排版使用系统字体。图片均为编辑部拍摄。', 'Set in system typefaces. Photographs by the editorial desk.'),
    cadence: [0, 7, 7, 7, 14, 7],
    articles: [
        {
            slug: 'slow-breakfast-after-rain',
            section: t('餐桌', 'Tables'),
            title: t('雨后街区的慢早餐', 'Slow Breakfast After the Rain'),
            dek: t('从老书店旁的小窗口开始，一条适合不赶时间的上午路线。', 'A morning route that starts at the little window beside the old bookshop, for days with nowhere to be.'),
            author: t('周以宁', 'Zhou Yining'),
            minutes: 6,
            tags: [t('早餐', 'Breakfast'), t('散步', 'Walks')],
            caption: t('雨停后的第一个小时，街面还带着反光。', 'The first hour after the rain, the pavement still holding the light.'),
            art: { variant: 'street', palette: ['#c9b8a3', '#6f7f86', '#2f3a40', '#e9dcc8'] },
            body: {
                zh: [
                    '雨刚停的早晨，梧桐路上的店铺大多还没开门，只有书店旁边那扇小窗亮着。窗口只卖三样东西：豆浆、葱油饼和一种加了桂花的米糕，八点以前基本都能买到。',
                    '拿着早餐沿街往南走，十分钟后就能看到河。河边的长椅通常是湿的，带一张旧报纸会让这一段路舒服很多。这个时间的河面很安静，偶尔有晨跑的人经过。',
                    '如果还想坐一会儿，桥头那家只有六个座位的咖啡店九点开门。手冲豆子每周换一次，店主会认真地告诉你今天这支豆子来自哪里，不急的话可以听完。',
                ],
                en: [
                    'On a morning just after rain, most shops on Plane Tree Avenue are still shuttered. Only the little window beside the bookshop is lit. It sells three things: soy milk, scallion pancakes and an osmanthus rice cake that usually lasts until about eight.',
                    'Walk south with your breakfast and the river appears after ten minutes. The benches along the bank are usually wet, so an old newspaper makes this stretch far more pleasant. The water is quiet at this hour, with the odd runner going by.',
                    'If you want to sit a while longer, the six-seat café by the bridge opens at nine. The pour-over beans change weekly, and the owner will tell you exactly where today\'s came from. If you are not in a hurry, hear the whole story.',
                ],
            },
        },
        {
            slug: 'three-kinds-of-light',
            section: t('展览', 'Exhibitions'),
            title: t('夜间展厅的三种光', 'Three Kinds of Light in a Night Gallery'),
            dek: t('周五延长开放的那几个小时，展厅像换了一座建筑。', 'During the late Friday hours, the gallery feels like a different building.'),
            author: t('林叙', 'Lin Xu'),
            minutes: 8,
            tags: [t('展览', 'Exhibitions'), t('建筑', 'Architecture')],
            caption: t('二层展厅，傍晚七点后只保留轨道灯。', 'The second-floor room after seven, lit only by the track lights.'),
            art: { variant: 'night', palette: ['#1d2230', '#c79a62', '#5d4b5a', '#f1e3c8'] },
            body: {
                zh: [
                    '第一种光来自天窗。下午四点以后，它从斜上方落进来，把白墙切成两半，画作的一侧暖、一侧冷，像是同一幅画有了两个版本。',
                    '第二种光是轨道灯。天黑以后，馆方会关掉顶灯，只留下对准作品的光束，观众的影子因此变得很淡，整个房间安静得能听到地板的木头声。',
                    '第三种光来自窗外的街道。三层尽头有一扇不对外说明的窗，正对着老街的路灯。很多人在那里站得比在任何一幅画前都久。',
                ],
                en: [
                    'The first light comes through the skylight. After four in the afternoon it falls at a steep angle and cuts the white wall in two, so each painting has a warm half and a cool half, as if there were two versions of it.',
                    'The second is the track lighting. Once it is dark the museum switches off the ceiling lights and leaves only the beams trained on the works. Visitors\' shadows grow faint and the room is quiet enough to hear the timber floor.',
                    'The third comes from the street outside. At the end of the third floor there is an unlabelled window facing the old street lamps. Many people stand there longer than in front of any painting.',
                ],
            },
        },
        {
            slug: 'from-the-bridge-to-the-florist',
            section: t('街区', 'Neighborhoods'),
            title: t('从桥下走到花店', 'From the Bridge to the Florist'),
            dek: t('一段不到两公里的路，经过一家修表铺、两棵老樟树和一家只在周末营业的花店。', 'Under two kilometres, past a watch repairer, two old camphor trees and a florist that only opens at weekends.'),
            author: t('周以宁', 'Zhou Yining'),
            minutes: 5,
            tags: [t('散步', 'Walks'), t('街区', 'Neighborhoods')],
            caption: t('桥洞下的台阶，下午三点左右光线最好。', 'Steps under the bridge, at their best around three in the afternoon.'),
            art: { variant: 'garden', palette: ['#dfe3d3', '#7d9471', '#3d5243', '#e9c9a5'] },
            body: {
                zh: [
                    '从石桥下的台阶出发，沿着河岸的步道往东。第一个路口转角有一家修表铺，师傅已经在这里坐了二十多年，玻璃柜里摆着客人忘了取回的旧表。',
                    '再往前是两棵老樟树，树下的石凳是附近居民下棋的地方。周末下午常常围着一圈人，你可以站在旁边看一局，没人会介意。',
                    '路的尽头是一家只在周六和周日开门的花店。店主每周五去花市进货，所以周六上午的花最全。买一小束带回家，这段路就算走完整了。',
                ],
                en: [
                    'Start from the steps under the stone bridge and follow the riverside path east. On the first corner is a watch repairer who has sat in the same spot for over twenty years; the glass case holds watches their owners never came back for.',
                    'Further on are two old camphor trees, with stone benches where neighbours play chess. On weekend afternoons a small crowd gathers. Stand and watch a game; nobody minds.',
                    'At the end of the road is a florist that only opens on Saturdays and Sundays. The owner buys at the flower market on Friday, so Saturday morning has the best choice. Take a small bunch home and the walk is complete.',
                ],
            },
        },
        {
            slug: 'quiet-reading-corners',
            section: t('阅读', 'Reading'),
            title: t('寻找角落里的静读空间', 'Finding Quiet Reading Corners'),
            dek: t('两家有窗边座位的街区书店，以及它们各自最安静的时段。', 'Two neighbourhood bookshops with window seats, and the quietest hour at each.'),
            author: t('沈禾', 'Shen He'),
            minutes: 7,
            tags: [t('书店', 'Bookshops'), t('阅读', 'Reading')],
            caption: t('靠窗的长桌，可以坐四个人，通常只坐一个。', 'The long table by the window seats four and usually holds one.'),
            art: { variant: 'window', palette: ['#efe2cc', '#b88a5c', '#5a4434', '#f7efe2'] },
            body: {
                zh: [
                    '第一家书店在一栋老公寓的一楼，进门要先下三级台阶。最里面的窗边有一张长桌，工作日上午几乎没有人，阳光正好落在桌面上。',
                    '第二家书店更小，以诗集和独立出版物为主。二楼有一个只放了两把椅子的阁楼，店员说下雨天最难抢到位置，晴天反而很空。',
                    '两家店都允许在店里读完再决定买不买，但请不要在书页上做标记。我们的建议是：带一本自己的书，再在店里挑一本，读累了就换着读。',
                ],
                en: [
                    'The first shop is on the ground floor of an old apartment block, three steps down from the street. At the very back is a long table by the window that is almost empty on weekday mornings, just as the sun lands on it.',
                    'The second is smaller and mostly poetry and independent press. Upstairs is a loft with only two chairs. The staff say it is hardest to get a seat on rainy days; on sunny days it is often empty.',
                    'Both shops let you read before deciding whether to buy, but please do not mark the pages. Our advice: bring a book of your own, pick one from the shelf, and switch between them when you tire.',
                ],
            },
        },
        {
            slug: 'a-market-morning-ledger',
            section: t('餐桌', 'Tables'),
            title: t('早市账本：一份时令蔬果清单', 'A Market Morning Ledger'),
            dek: t('我们在同一个早市连续记了四周的价格和摊位，这是整理后的版本。', 'We logged prices and stalls at the same morning market for four weeks. Here is the tidy version.'),
            author: t('沈禾', 'Shen He'),
            minutes: 9,
            tags: [t('市集', 'Markets'), t('时令', 'Seasonal')],
            caption: t('第三排的菌菇摊，七点前到才能挑到最好的。', 'The mushroom stall in the third row; arrive before seven for the best of it.'),
            art: { variant: 'still', palette: ['#e8d6bb', '#a4573d', '#4f6b3c', '#f4e7d1'] },
            body: {
                zh: [
                    '早市六点开始，真正热闹是在六点半到七点半之间。入口第一排以叶菜为主，价格每天浮动；越往里走，摊位越固定，老板也越愿意聊天。',
                    '这四周里最稳定的是豆制品和鸡蛋，价格几乎没有变化；变化最大的是菌菇和浆果，一场雨就能让价格差出一倍。',
                    '我们的经验是带现金和布袋，先逛一圈再买。最后一排有一位卖自家腌菜的阿姨，没有招牌，但几乎每个熟客都会在她那里停一下。',
                ],
                en: [
                    'The market opens at six and is at its busiest between half past six and half past seven. The first row is mostly leafy greens with prices that move daily; deeper in, the stalls are more permanent and the owners more willing to talk.',
                    'Over four weeks the steadiest prices were tofu and eggs, which barely moved. The most volatile were mushrooms and berries, where a single rainy day could double the price.',
                    'Our advice is to bring cash and a cloth bag and do one lap before buying anything. In the last row, a woman sells her own pickles. There is no sign, but almost every regular stops there.',
                ],
            },
        },
        {
            slug: 'stairwells-and-terrazzo',
            section: t('街区', 'Neighborhoods'),
            title: t('楼梯间与水磨石', 'Stairwells and Terrazzo'),
            dek: t('老公寓的楼梯间里，藏着这座城市最耐看的地面。', 'Some of the city\'s most beautiful floors are hiding in old apartment stairwells.'),
            author: t('林叙', 'Lin Xu'),
            minutes: 6,
            tags: [t('建筑', 'Architecture'), t('街区', 'Neighborhoods')],
            caption: t('三层转角的水磨石拼花，铜条已经磨得发亮。', 'Terrazzo inlay at the third-floor turn, the brass strips worn bright.'),
            art: { variant: 'dusk', palette: ['#d9c7b4', '#8a6f63', '#3e3b45', '#f0e4d4'] },
            body: {
                zh: [
                    '上世纪的公寓楼很少有华丽的立面，但楼梯间往往被认真对待。水磨石地面里嵌着铜条，拼出简单的几何图案，几十年踩下来反而更亮。',
                    '我们走访了街区里的七栋老楼，其中五栋的楼梯间依然保留着原来的地面。扶手大多是木头的，转角处被手掌磨出了柔和的弧度。',
                    '请记得这些是居民的家。进楼前先打个招呼，不要在楼道里久留，也不要拍摄住户的门牌。',
                ],
                en: [
                    'Mid-century apartment blocks rarely have grand façades, but the stairwells were often treated with care. Brass strips are set into terrazzo to form simple geometric patterns that have only grown brighter under decades of footsteps.',
                    'We visited seven old buildings in the neighbourhood; five still have their original floors. Most handrails are timber, worn into soft curves at the turns by countless palms.',
                    'Please remember these are people\'s homes. Say hello before going in, do not linger in the stairwell, and do not photograph residents\' door numbers.',
                ],
            },
        },
    ],
};

const PHOTO_BLOG: CamouflageSiteContent = {
    articleBase: '/posts',
    tagline: t('一台旧相机，几条常走的街，和一些不太重要的观察。', 'One old camera, a few familiar streets and some unimportant observations.'),
    kicker: t('街头影像', 'Street Photo Notes'),
    sections: [t('胶片', 'Film'), t('街拍', 'Street'), t('笔记', 'Notes')],
    aboutTitle: t('关于', 'About'),
    about: {
        zh: [
            '你好，我是阿澄。白天做书籍设计，周末背着一台比我年纪还大的旁轴相机在城里散步。',
            '这个网站是我的照片笔记本：没有评论区，没有统计，也不会经常更新。照片大多是在家附近拍的，冲扫也是自己完成。',
            '照片和文字请勿转载。如果你想聊聊胶片或者书，可以给我写邮件。',
        ],
        en: [
            'Hello, I am Cheng. I design books during the week and on weekends walk around the city with a rangefinder older than I am.',
            'This site is my photo notebook: no comments, no analytics and no regular schedule. Most pictures are taken near home, and I develop and scan them myself.',
            'Please do not repost the photos or text. If you would like to talk about film or books, send me an email.',
        ],
    },
    colophon: t('所有照片均以胶片拍摄。', 'All photographs shot on film.'),
    cadence: [0, 9, 12, 8, 16, 11],
    articles: [
        {
            slug: 'evening-by-a-white-wall',
            section: t('胶片', 'Film'),
            title: t('白墙前的傍晚', 'Evening by a White Wall'),
            dek: t('同一面墙，连续拍了七个傍晚。', 'The same wall, photographed on seven consecutive evenings.'),
            author: t('阿澄', 'Cheng'),
            minutes: 4,
            tags: [t('胶片', 'Film'), t('光线', 'Light')],
            caption: t('35mm · f/4 · 1/60s · Portra 400', '35mm · f/4 · 1/60s · Portra 400'),
            art: { variant: 'dusk', palette: ['#ead9c6', '#c88b6e', '#5d5266', '#f6ece0'] },
            body: {
                zh: [
                    '家门口有一面朝西的白墙，傍晚六点左右，对面楼的影子会慢慢爬上来。我连续一周在同一个位置按下快门，每天只拍一张。',
                    '冲出来以后才发现，七张照片的颜色都不一样：周二有薄云，墙面偏粉；周五空气很干净，影子的边缘锋利得像刀切。',
                    '这组照片没有什么主题，只是提醒我自己：同一个地方，多看几次才算真正看过。',
                ],
                en: [
                    'Outside my door is a west-facing white wall. Around six in the evening the shadow of the building opposite creeps up it. For a week I stood in the same spot and took one frame a day.',
                    'Only after developing did I notice that all seven frames are a different colour. Tuesday had thin cloud and the wall went pink; Friday\'s air was so clear the edge of the shadow looked knife-cut.',
                    'The set has no theme. It just reminds me that you have only really seen a place after looking at it several times.',
                ],
            },
        },
        {
            slug: 'twelve-umbrellas-at-a-crossing',
            section: t('街拍', 'Street'),
            title: t('路口的十二把伞', 'Twelve Umbrellas at a Crossing'),
            dek: t('一个红灯的时间里，数到了十二把伞。', 'Twelve umbrellas, counted during a single red light.'),
            author: t('阿澄', 'Cheng'),
            minutes: 3,
            tags: [t('街拍', 'Street'), t('雨天', 'Rain')],
            caption: t('50mm · f/2.8 · 1/125s · HP5 推 800', '50mm · f/2.8 · 1/125s · HP5 pushed to 800'),
            art: { variant: 'street', palette: ['#b9c0c4', '#56626b', '#22292f', '#dfe3e3'] },
            body: {
                zh: [
                    '下雨天我喜欢站在天桥上往下拍。红灯亮起，路口很快聚起一圈伞，从上面看像一张临时拼起来的桌布。',
                    '这一张数到了十二把伞，其中一把是透明的，下面的人正在低头看手机。绿灯一亮，所有的伞在三秒内散开。',
                    '黑白卷推了一档，颗粒很粗，但雨天就应该是这个样子。',
                ],
                en: [
                    'On rainy days I like to shoot down from the footbridge. When the light turns red, umbrellas gather at the crossing and from above look like a tablecloth pieced together on the spot.',
                    'In this frame I counted twelve. One is transparent, and the person underneath is looking down at a phone. When the light turned green, they all scattered within three seconds.',
                    'The black-and-white roll was pushed a stop and the grain is coarse, but that is how a rainy day should look.',
                ],
            },
        },
        {
            slug: 'sunday-on-the-laundry-lines',
            section: t('街拍', 'Street'),
            title: t('晾衣绳上的周日', 'Sunday on the Laundry Lines'),
            dek: t('老街区的周日上午，每个阳台都在晒太阳。', 'Sunday morning in the old quarter, every balcony out in the sun.'),
            author: t('阿澄', 'Cheng'),
            minutes: 3,
            tags: [t('街区', 'Neighborhoods'), t('胶片', 'Film')],
            caption: t('35mm · f/8 · 1/250s · Gold 200', '35mm · f/8 · 1/250s · Gold 200'),
            art: { variant: 'garden', palette: ['#f0e2c4', '#d39a63', '#5f7c86', '#fbf3e3'] },
            body: {
                zh: [
                    '周日上午十点，老街区的晾衣绳上挂满了床单和衬衫。风一吹，整条巷子像在呼吸。',
                    '我没有走进巷子，只是站在路口拍了一卷。照片里看不到人，但每一件衣服都在说这一家人的生活。',
                ],
                en: [
                    'At ten on a Sunday morning the laundry lines in the old quarter are full of sheets and shirts. When the wind picks up, the whole alley seems to breathe.',
                    'I did not walk in; I shot one roll from the corner. There are no people in the frames, yet every piece of clothing says something about the family it belongs to.',
                ],
            },
        },
        {
            slug: 'twenty-minutes-by-the-tram-window',
            section: t('笔记', 'Notes'),
            title: t('电车窗边的二十分钟', 'Twenty Minutes by the Tram Window'),
            dek: t('从起点站坐到终点站，只拍窗外。', 'From the first stop to the last, photographing only what is outside the window.'),
            author: t('阿澄', 'Cheng'),
            minutes: 5,
            tags: [t('笔记', 'Notes'), t('城市', 'City')],
            caption: t('28mm · f/5.6 · 1/500s · Ektar 100', '28mm · f/5.6 · 1/500s · Ektar 100'),
            art: { variant: 'window', palette: ['#d7dde0', '#8aa0a8', '#3a4a52', '#f2efe7'] },
            body: {
                zh: [
                    '这条电车线全程二十分钟，经过河、菜场、两所学校和一段很长的围墙。我坐在最后一排靠窗的位置，规定自己只拍窗外。',
                    '车窗有反光，所以很多照片里都叠着车厢里的灯。一开始觉得是失误，后来反而喜欢上这种两层画面。',
                    '终点站有一家卖烤红薯的小摊，十一月以后才出摊。拍完最后一张，正好买一个暖手。',
                ],
                en: [
                    'This tram line takes twenty minutes end to end, passing the river, a market, two schools and a very long wall. I sat in the back row by the window and allowed myself to photograph only what was outside.',
                    'The glass reflects, so many frames carry the lights of the carriage laid over the street. At first it seemed like a mistake; now I like the double layer.',
                    'At the last stop there is a roast sweet-potato stand that only appears after November. After the final frame I bought one to warm my hands.',
                ],
            },
        },
        {
            slug: 'the-bakery-at-six',
            section: t('胶片', 'Film'),
            title: t('清晨六点的面包房', 'The Bakery at Six'),
            dek: t('拍面包师之前，先买了两个可颂。', 'Before photographing the baker, I bought two croissants.'),
            author: t('阿澄', 'Cheng'),
            minutes: 4,
            tags: [t('人物', 'People'), t('胶片', 'Film')],
            caption: t('50mm · f/2 · 1/30s · Portra 800', '50mm · f/2 · 1/30s · Portra 800'),
            art: { variant: 'still', palette: ['#f1dfc2', '#c48346', '#5c3b28', '#fbf1e1'] },
            body: {
                zh: [
                    '街角面包房的灯每天五点半亮起。我问老板能不能拍几张，他说可以，但要先等第一炉出来。',
                    '室内光线很暗，只能把光圈开到最大，快门放到三十分之一。几张照片有些虚，但面粉在灯下飘起来的样子刚好留住了。',
                ],
                en: [
                    'The corner bakery switches on its lights at half past five every day. I asked the owner if I could take a few pictures; he said yes, once the first batch was out.',
                    'The room was dark, so I shot wide open at a thirtieth of a second. Some frames are soft, but the flour drifting in the lamplight made it through.',
                ],
            },
        },
        {
            slug: 'a-few-notes-on-scanning-negatives',
            section: t('笔记', 'Notes'),
            title: t('扫描底片的一点笔记', 'A Few Notes on Scanning Negatives'),
            dek: t('不讲器材，只讲这两年慢慢摸索出来的几个习惯。', 'Not about gear, just a few habits worked out over two years.'),
            author: t('阿澄', 'Cheng'),
            minutes: 6,
            tags: [t('笔记', 'Notes'), t('冲扫', 'Scanning')],
            caption: t('灯箱上的一条 135 底片。', 'A strip of 35mm negatives on the light table.'),
            art: { variant: 'night', palette: ['#2a2622', '#b7865a', '#4b5d63', '#efe4d2'] },
            body: {
                zh: [
                    '第一，扫描前先把底片压平一晚。卷曲的底片会让边缘失焦，后期很难救回来。',
                    '第二，白平衡在整卷里统一设置一次，不要每张单独调。这样一卷照片的色调会更一致，也更像当天的天气。',
                    '第三，保留一点灰尘。完全干净的扫描看起来像数码照片，偶尔的一两个小点反而让我记得这是胶片。',
                ],
                en: [
                    'First, flatten the negatives overnight before scanning. Curled film throws the edges out of focus and that is hard to fix later.',
                    'Second, set white balance once for the whole roll rather than per frame. The roll stays consistent and looks more like the weather that day.',
                    'Third, leave a little dust. A perfectly clean scan looks digital; one or two specks remind me that this was film.',
                ],
            },
        },
    ],
};

const WEEKEND_GUIDE: CamouflageSiteContent = {
    articleBase: '/guides',
    tagline: t('每周四更新：这个周末去哪儿、吃什么、怎么走。', 'Updated every Thursday: where to go, what to eat and how to get there this weekend.'),
    kicker: t('周末城市指南', 'Weekend City Guide'),
    sections: [t('市集', 'Markets'), t('展览', 'Exhibitions'), t('咖啡', 'Cafés'), t('散步', 'Walks'), t('演出', 'Live')],
    aboutTitle: t('关于这份指南', 'About this guide'),
    about: {
        zh: [
            '这是一份由三个朋友维护的周末指南。我们每周四发布新一期，只推荐自己去过、并且愿意再去一次的地方。',
            '活动信息以主办方公布为准，临时变动请以现场为准。如果你是店主或策展人，欢迎来信介绍你的活动，但我们不收取任何推广费用。',
        ],
        en: [
            'This weekend guide is kept by three friends. A new edition goes out every Thursday, and we only recommend places we have been to and would happily visit again.',
            'Event details follow what the organisers publish; check on the day for last-minute changes. If you run a shop or curate a show, write and tell us about it, but we never charge for coverage.',
        ],
    },
    colophon: t('信息核对于发布当周。', 'Details checked in the week of publication.'),
    cadence: [0, 3, 7, 7, 10],
    articles: [
        {
            slug: 'riverside-weekend-market',
            section: t('市集', 'Markets'),
            title: t('河岸周末市集', 'Riverside Weekend Market'),
            dek: t('四十个摊位、一支街头乐队，和全城最好吃的葱油饼。', 'Forty stalls, a street band and the best scallion pancakes in town.'),
            author: t('小满', 'Xiaoman'),
            minutes: 4,
            tags: [t('市集', 'Markets'), t('亲子', 'Family')],
            caption: t('旧码头广场，上午十点。', 'Old Pier Square, ten in the morning.'),
            art: { variant: 'garden', palette: ['#e6dcc6', '#c9784f', '#3f6b63', '#f6efe0'] },
            event: {
                when: t('周六 09:00 – 15:00', 'Sat 09:00 – 15:00'),
                venue: t('旧码头广场', 'Old Pier Square'),
                price: t('免费', 'Free'),
            },
            body: {
                zh: [
                    '河岸市集每月第二个周末举办，今年移到了翻新后的旧码头广场。摊位以手作、旧物和本地小吃为主，比去年多了十来家。',
                    '建议十点前到，葱油饼和桂花糕通常中午前就卖完了。广场东侧有树荫和长椅，带小朋友的话可以在那里歇脚。',
                    '公共交通最方便：地铁站出来步行八分钟。附近停车位很少，周末更是一位难求。',
                ],
                en: [
                    'The riverside market runs on the second weekend of each month and this year has moved to the renovated Old Pier Square. The stalls are mostly handmade goods, vintage finds and local snacks, with about ten more than last year.',
                    'Get there before ten: the scallion pancakes and osmanthus cakes are usually gone by noon. There is shade and benches on the east side of the square if you have children with you.',
                    'Public transport is easiest, an eight-minute walk from the station. Parking nearby is scarce, especially at weekends.',
                ],
            },
        },
        {
            slug: 'print-studio-open-day',
            section: t('展览', 'Exhibitions'),
            title: t('版画工作室开放日', 'Print Studio Open Day'),
            dek: t('可以亲手印一张明信片带走。', 'Print a postcard by hand and take it home.'),
            author: t('阿卷', 'Ajuan'),
            minutes: 3,
            tags: [t('展览', 'Exhibitions'), t('手作', 'Making')],
            caption: t('工作室里的老式压印机。', 'The old press in the studio.'),
            art: { variant: 'still', palette: ['#ece3d4', '#3f4d6b', '#b3533f', '#faf6ee'] },
            event: {
                when: t('周六、周日 13:00 – 18:00', 'Sat & Sun 13:00 – 18:00'),
                venue: t('纺织厂旧址 B 栋二层', 'Old Textile Mill, Building B, 2F'),
                price: t('¥40（含材料）', '¥40 (materials included)'),
            },
            body: {
                zh: [
                    '这家版画工作室平时只对学员开放，每季度有一次开放日。今年的主题是城市里的植物，墙上挂着二十多张木刻和丝网作品。',
                    '现场可以在老式压印机上印一张明信片，工作人员会讲解每一步。排队的人不少，建议下午早点去。',
                ],
                en: [
                    'This print studio normally only opens to its students, with one open day a season. This year\'s theme is plants of the city, with more than twenty woodcuts and screen prints on the walls.',
                    'You can print a postcard on the old press, and staff explain every step. The queue gets long, so go early in the afternoon.',
                ],
            },
        },
        {
            slug: 'window-seat-drinks',
            section: t('咖啡', 'Cafés'),
            title: t('窗边热饮：五家安静的咖啡馆', 'Window-Seat Drinks: Five Quiet Cafés'),
            dek: t('天气转凉，适合找一个靠窗的位置坐一下午。', 'As the weather cools, a window seat for the afternoon.'),
            author: t('小满', 'Xiaoman'),
            minutes: 7,
            tags: [t('咖啡', 'Cafés'), t('秋冬', 'Autumn & winter')],
            caption: t('梧桐路上的二楼窗位。', 'A first-floor window seat on Plane Tree Avenue.'),
            art: { variant: 'window', palette: ['#efe1cd', '#a86b45', '#46362c', '#f8f0e4'] },
            body: {
                zh: [
                    '我们挑了五家有好窗位的咖啡馆：两家在老街区，一家在美术馆旁边，还有两家藏在居民楼里。共同点是工作日下午人不多，音乐音量刚好。',
                    '如果只能去一家，推荐梧桐路上那家二楼的小店。窗外正对着两棵法国梧桐，热巧克力用的是整块可可，不太甜。',
                    '请注意其中三家周一休息，另外两家不接待超过四人的团体。',
                ],
                en: [
                    'We picked five cafés with good window seats: two in the old quarter, one beside the art museum and two tucked inside residential blocks. All are quiet on weekday afternoons with the music at a sensible volume.',
                    'If you only visit one, go to the little first-floor place on Plane Tree Avenue. The window faces two plane trees, and the hot chocolate is made from solid cocoa and not too sweet.',
                    'Note that three of them close on Mondays and the other two do not take groups larger than four.',
                ],
            },
        },
        {
            slug: 'the-hill-path-loop',
            section: t('散步', 'Walks'),
            title: t('后山步道环线', 'The Hill Path Loop'),
            dek: t('全程六公里，两个半小时，适合不想走太远的周日。', 'Six kilometres, two and a half hours, for a Sunday when you do not want to go far.'),
            author: t('阿卷', 'Ajuan'),
            minutes: 5,
            tags: [t('散步', 'Walks'), t('自然', 'Outdoors')],
            caption: t('步道中段的观景台。', 'The lookout halfway along the path.'),
            art: { variant: 'dusk', palette: ['#dfd8c8', '#94a07c', '#4b5a4a', '#f3eadb'] },
            event: {
                when: t('全天开放', 'Open all day'),
                venue: t('后山公园南门', 'Hill Park, South Gate'),
                price: t('免费', 'Free'),
            },
            body: {
                zh: [
                    '从南门进山，沿着石阶走到观景台大约四十分钟。这一段坡度最大，之后就是平缓的林间小路。',
                    '环线后半段经过一片竹林和一个小水库，秋天的下午光线很好。终点回到北门，门口有一家开了三十年的面馆。',
                    '步道没有路灯，请在日落前一小时出发返回。雨后石阶较滑，建议穿防滑的鞋。',
                ],
                en: [
                    'Enter at the south gate and climb the stone steps to the lookout in about forty minutes. This is the steepest part; after that it is a gentle path through the woods.',
                    'The second half of the loop passes a bamboo grove and a small reservoir, lovely in autumn afternoon light. It ends at the north gate, where a noodle shop has been open for thirty years.',
                    'There are no lights on the path, so start back an hour before sunset. The steps are slippery after rain; wear shoes with grip.',
                ],
            },
        },
        {
            slug: 'jazz-night-in-the-courtyard',
            section: t('演出', 'Live'),
            title: t('院子里的爵士夜', 'Jazz Night in the Courtyard'),
            dek: t('一支三重奏，一个老院子，和一壶桂花酒。', 'A trio, an old courtyard and a pot of osmanthus wine.'),
            author: t('小满', 'Xiaoman'),
            minutes: 3,
            tags: [t('演出', 'Live'), t('夜晚', 'Evenings')],
            caption: t('演出前的院子。', 'The courtyard before the set.'),
            art: { variant: 'night', palette: ['#1f1d24', '#d29a55', '#6a3f3a', '#f5e4c6'] },
            event: {
                when: t('周五 20:00', 'Fri 20:00'),
                venue: t('西巷 17 号院', 'No. 17 West Lane Courtyard'),
                price: t('¥80（含一杯饮品）', '¥80 (one drink included)'),
            },
            body: {
                zh: [
                    '西巷 17 号是一座修缮过的老院子，每月最后一个周五会请乐队来演出。这次是一支钢琴、贝斯和鼓的三重奏，以标准曲目为主。',
                    '院子只能容纳六十人左右，没有预留座位，先到先坐。天冷的话，主人会在角落里生一个小火炉。',
                ],
                en: [
                    'No. 17 West Lane is a restored courtyard house that invites a band on the last Friday of every month. This time it is a piano, bass and drums trio playing mostly standards.',
                    'The courtyard holds about sixty people with no reserved seating, so arrive early. If it is cold, the hosts light a small stove in the corner.',
                ],
            },
        },
    ],
};

export const CAMOUFLAGE_CONTENT: Record<string, CamouflageSiteContent> = Object.freeze({
    corporate: MAGAZINE,
    blog: PHOTO_BLOG,
    nginx: WEEKEND_GUIDE,
});
