import { Wrapper, change } from "lofi-girl-api-wrapper";
import { rmSync, readFileSync, createWriteStream, existsSync } from 'node:fs'
import confs from './configs.json'
import { config } from 'dotenv'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set, get, onValue, remove } from 'firebase/database'
import { getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'
import { station } from "./typings/station";
import ytdl, { getBasicInfo, getVideoID } from "ytdl-core";
import axios from "axios";
config()

const app = initializeApp({
    databaseURL: process.env.dbUrl,
    storageBucket: process.env.bucketUrl
})
const db = getDatabase(app)
const storage = getStorage(app)
const configs = {
    dbRef: 'stations'
}

const send = (msg: string, color = '#5E2D50') => {
    if (!process.env.webhookUrl) return
    const embeds = [
        {
            title: "Log",
            description: `Un log a été reçu : \`\`\`${msg}\`\`\``,
            color: parseInt(color.replace('#', ''), 16)
        }
    ]

    const config = {
        method: "POST",
        url: process.env.webhookUrl,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ embeds }),
    }

    axios(process.env.webhookUrl, {
        headers: {
            'Content-Type': 'application/json'
        },
        method: 'POST',
        data: JSON.stringify({ embeds })
    }).catch((err) => {
        console.log(err)
    })
}
const getStation = (id: string): Promise<station<false> | null> => {
    return new Promise(resolve => {
        get(ref(db, `${configs.dbRef}/${id}`)).then((snap) => {
            if (snap.exists()) {
                const value = snap.val() as station<true>
                resolve({
                    ...value,
                    tracks: JSON.parse(value.tracks ?? '{}'),
                    authors: JSON.parse(value.authors ?? '[]')
                })
            } else {
                resolve(null)
            }
        }).catch(() => {
            resolve(null)
        })
    })
}
const pushStation = async(change: change<'stationAdd'>) => {
    return new Promise(async resolve => {
        const info = await getBasicInfo(change.url).catch((err) => {
            console.log(err)
        })
        if (!info) return send(`No info on youtube for ${change.name}`)
        if (!info.videoDetails.thumbnails[0]?.url) return send(`No thumbnail for ${change.name}`)
    
        const extractTracks = () => {
            const description = info.videoDetails.description;
            const splited = description.split(/tracklist/gim);
            const tracks = splited.find((x) => x.includes('['));
            if (!tracks) return {};
    
            const timestampRegex = /\[((\d\d?):?)?\d\d:\d\d\]/;
            const songs = tracks.split('\n').filter((x) => timestampRegex.test(x));
    
            const timestamps: Record<string, string> = {};
            songs.forEach((song) => {
                const splitedSong = song.split(' ');
    
                const tm = splitedSong.shift();
                const t = tm.slice(1, tm.length - 1);
                timestamps[t] = splitedSong.join(' ');
            });
    
            return timestamps;
        };
        const tracks = extractTracks();
        const getAuthors = (): { authors: string[]; rest: string; } => {
            const cp = change.name.split(/ ?- ?/)
            const section = cp.shift()
            if (!section) return { authors: [], rest: change.name }
    
            return { authors: section.split(/ (x|&) /).map(sc => sc.replace(/^ (.+)/, '$1').replace(/(.+) $/, '$1')), rest: cp.join(' ') }
        }
        const split = (): [string[], string, string] => {
            const { authors, rest: title } = getAuthors()
    
            const splitted = title.split(/ ?\(/)
            const name = `${splitted[0] ?? 'no name'} ${change.emoji}`
            const beats = splitted[1] ? `${splitted[1].replace(/\)/g, '')}` : 'no beats'
    
            return [authors, name, beats]
        }
        const [authors, name, beats] = split()
        const infos: station = {
            tracks: JSON.stringify(tracks),
            authors: JSON.stringify(authors),
            beats: beats,
            img: info.videoDetails.thumbnails[0].url,
            id: getVideoID(change.url),
            title: name,
            url: change.url
        }
    
        const path = `./${infos.id}.mp3`;
        ytdl(infos.url, { filter: 'audioonly', quality: 'highestaudio' })
            .pipe(createWriteStream(path))
            .on('finish', () => {
                const file = readFileSync(path)
                uploadBytes(storageRef(storage, path), file).catch(send)
                
                set(ref(db, `${configs.dbRef}/${infos.id}`), infos).catch((error) => {
                    send(error)
                    return null
                })

                if (existsSync(path)) rmSync(path)

                send(`Pushed ${change.name} ${change.emoji}`)
                resolve('ended')
            }).on('error', (err) => {
                send(err.message)
                if (existsSync(path)) rmSync(path)
                resolve('errored')
            })
    })
}

const sync = () => {
    send("Sart syncing", "#D0E545")
    return new Promise(resolve => {
        let stations = confs.stations
        let stored: string[] = []
        
        onValue(ref(db, `${configs.dbRef}`), (snap) => {
            stored = Object.keys(snap.val())
        })

        setTimeout(async () => {
            stations = stations.filter(x => !stored.includes(getVideoID(x.url)) && x.type === 'playlist')
            const tasks = {
                started: 0,
                done: 0
            }
            const color = (cl: string | number, text: string) => `\x1b[${cl}m${text}\x1b[0m`
            const count = () => color(36, `(${tasks.done}/${stations.length})`)
            const checkEnd = () => {
                if (tasks.done === stations.length) {
                    console.log(color(33, 'Finished'))
                }
            }
        
            const mapper = async(v: typeof stations[0]) => {
                console.log(`${color('34', 'Pushing')} ${v.name} ${v.emoji}`)
                tasks.started++
            
                await pushStation({
                    emitterId: 'me',
                    emoji: v.emoji,
                    name: v.name,
                    type: 'playlist',
                    url: v.url
                })
                tasks.done++
            
                console.log(`${color('32', 'Pushed')} ${v.name} ${v.emoji} ${count()}`)
                checkEnd()
            }
        
            for (const st of stations) {
                await mapper(st)
            }

            send("End syncing", "#1D7DEB")
            resolve('ok')
        }, 10000)
    })
}
sync()

const listener = new Wrapper({
    id: 'lofi-mobile-updater.script',
    port: process.env.port,
    apiPort: process.env.apiPort
})

listener.onReceive((type, change) => {
    if (type === 'stationAdd') {
        const values = (change as change<'stationAdd'>);
        pushStation(values)
    }
    if (type === 'stationRemove') {
        const id = getVideoID(change.url)
        if (!id) return send(`No id found to delete ${change.url}`)

        remove(ref(db, `${configs.dbRef}/${id}`)).catch(send);
    }
})