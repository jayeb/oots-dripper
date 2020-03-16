var _ = require('lodash'),
    axios = require('axios'),
    cheerio = require('cheerio'),
    FTPClient = require('promise-ftp');

var GITP_COMIC_URL = 'https://www.giantitp.com/comics/oots%N.html',
    DRIP_RSS_URL = 'http://rss.jayeb.com/oots.rss',
    DRIP_RSS_PATH = 'rss.jayeb/oots.rss';

var $rss;

function getNextItem(currentIndex) {
  var nextIndex = currentIndex + 1,
      paddedNextIndex = _.padStart(nextIndex, 4, '0'),
      comicURL = GITP_COMIC_URL.replace(/%N/, paddedNextIndex);

  // Download RSS file
  return axios({
        method: 'get',
        url: comicURL,
        responseType: 'text'
      })
    .then(function parseDOM(response) {
        return cheerio.load(response.data);
      })
    .then(function getNextItem(htmlData) {
        var $root = htmlData.root();

        return {
          link: comicURL,
          index: nextIndex,
          title: $root.find('b').last().text(),
          image: $root.find('img[src^="https://i.giantitp.com//comics/oots"]').attr('src')
        };
      });
}

function pushToRemote(xmlContent) {
  var fileBuffer = Buffer.from(xmlContent, 'utf-8'),
      ftp = new FTPClient();

  return ftp.connect({
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD
      })
    .then(function putFile() {
        return ftp.put(fileBuffer, DRIP_RSS_PATH);
      })
    .then(_.ary(ftp.end, 0));
}

// Canary in the coalmine
if (!process.env.FTP_USER) {
  require('dotenv').config();
}

return axios({
      method: 'get',
      url: DRIP_RSS_URL,
      responseType: 'text'
    })
  .then(function parseDOM(response) {
      $rss = cheerio.load(response.data, {
        xml: {
            xmlMode: true
          }
      });
    })
  .then(function getCurrentIndex() {
      indexText = $rss
        .root()
        .find('dripper\\:index')
        .text();

      return parseInt(indexText, 10);
    })
  .then(getNextItem)
  .then(function updateDOM(nextItem) {
      var today = new Date(),
          $root = $rss.root(),
          $latestItem = $root.find('item').first(),
          $newItem = $rss('<item/>'),
          $img;

      // Update index
      $root.find('dripper\\:index').text(nextItem.index);

      // Build and insert new item
      newItemXML = `<item>
          <title>${ nextItem.index }: ${ nextItem.title }</title>
          <description>
            <img src="${ nextItem.image }" />
          </description>
          <link>${ nextItem.link }</link>
          <pubDate>${ today.toUTCString() }</pubDate>
        </item>
        `;

      $rss(newItemXML).insertBefore($latestItem);

      return $rss.xml();
    })
  .then(pushToRemote)
  .then(function onSuccess() {
      console.log('Done');

      return process.exit(0);
    })
  .catch(function onError(error) {
      console.error(error);

      return process.exit(1);
    })
