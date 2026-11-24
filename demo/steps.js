// The demo's shot list (record.js runs it). The searches are lines from the two demo sources' transcripts.
const P = { apolloQ: 'eagle has landed', duckQ: 'duck and cover' }

module.exports = async a => {
  const { log, cut, waitFor, sleep, move, click, drag, type, key, caption, card, js, center } = a
  const hide = () => caption('')

  // 1. title
  log('title')
  await card(`{logo}<h1>SIGNAL <span>HUNTER</span></h1><p>Find samples and clips by what's said</p>`)
  await sleep(3200)
  await card('', false); await sleep(900)

  // 2. free sources
  log('free sources')
  await caption('Bring in audio and video from anywhere', 'your files · any URL · free public-domain archives')
  await sleep(1400)
  await click('#archBtn'); await sleep(700)
  await click('#archSrc [data-src="nasa"]'); await sleep(500)
  await click('#archQ', 400); await type('apollo 11'); await sleep(250)
  await key('Enter', 'Enter', 13)
  await waitFor(`!!document.querySelector('#archCards .card')`)
  await sleep(1800)
  await move(...await center('#archCards .card'), 700); await sleep(900)
  await key('Escape', 'Escape', 27); await hide(); await sleep(700)

  // 3. search what's said
  log("search what's said")
  await caption('Everything gets transcribed. Search for what\'s said.')
  await click('#q', 600); await sleep(300)
  await type(P.apolloQ, 110); await sleep(1600)

  // 4. click a line: clip ready
  log('click a line: clip ready')
  await caption('Click a line and the clip is ready to play', 'with a few seconds of room on either side')
  await click('#results .seg', 700); await cut(() => waitFor(`/Apollo.*window/.test(document.querySelector('#info').textContent) && document.querySelector('#video').readyState >= 2`)); await sleep(900)
  await key(' ', 'Space', 32); await sleep(6400)  // plays the line once and stops at the selection's end

  // 5. trim
  log('trim')
  await caption('Drag to trim. Loop it while you dial it in.')
  const [wx, wy, ww, wh] = await js(`(() => { const r = document.querySelector('#wave').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()`)
  const my = wy + wh / 2
  // a short selection around "Tranquility Base here, the Eagle has landed" so the loop comes round twice
  await move(wx + ww * 0.17, my, 700); await drag(wx + ww * 0.40, my, 900); await sleep(500)
  await click('#loop', 600); await sleep(200)
  await key(' ', 'Space', 32); await sleep(12500); await key(' ', 'Space', 32); await sleep(300)

  // 6. export
  log('export')
  await caption('Export a WAV for your DAW, or an MP4 for your video editor', 'silent or with sound')
  await click('#exportMp4', 700)
  await cut(() => waitFor(`/Saved.*mp4/.test(document.querySelector('#status').textContent)`))
  await sleep(2200)

  // 7. another source, another sample
  log('another source, another sample')
  await caption('One search across all your sources')
  await click('#q', 600); await js(`document.querySelector('#q').select()`)
  await type(P.duckQ, 110); await sleep(1500)
  await click('#results .seg', 700); await cut(() => waitFor(`/Duck.*window/.test(document.querySelector('#info').textContent) && document.querySelector('#video').readyState >= 2`)); await sleep(900)
  await key(' ', 'Space', 32); await sleep(3500); await key(' ', 'Space', 32)
  await click('#export', 700)
  await cut(() => waitFor(`/Saved.*wav/.test(document.querySelector('#status').textContent)`))
  await sleep(1800)

  // 8. Live: real footage goes here (demo/live.js splices it in at this mark)
  log('Live')
  await hide(); await sleep(500)
  a.mark('live'); await sleep(600)  // the crossfade into Live uses 0.4 s past the mark: keep the end card out of it

  // 9. end card
  log('end card')
  a.mark('card')
  await card(`{logo}<h1>SIGNAL <span>HUNTER</span></h1><p>Free · Windows and Mac · runs in Ableton Live or your browser</p><small>github.com/donrolling/signal-hunter</small>`)
  await sleep(4000)
}
