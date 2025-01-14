// https://github.com/farzher/fuzzysort v2.0.4
/*
  SublimeText-like Fuzzy Search

  fuzzysort.single('fs', 'Fuzzy Search') // {score: -16}
  fuzzysort.single('test', 'test') // {score: 0}
  fuzzysort.single('doesnt exist', 'target') // null

  fuzzysort.go('mr', [{file:'Monitor.cpp'}, {file:'MeshRenderer.cpp'}], {key:'file'})
  // [{score:-18, obj:{file:'MeshRenderer.cpp'}}, {score:-6009, obj:{file:'Monitor.cpp'}}]

  fuzzysort.go('mr', ['Monitor.cpp', 'MeshRenderer.cpp'])
  // [{score: -18, target: "MeshRenderer.cpp"}, {score: -6009, target: "Monitor.cpp"}]

  fuzzysort.highlight(fuzzysort.single('fs', 'Fuzzy Search'), '<b>', '</b>')
  // <b>F</b>uzzy <b>S</b>earch
*/

'use strict';

var go = (search, targets, options) => {
    var preparedSearch = getPreparedSearch(search)
    var searchBitflags = preparedSearch.bitflags

    var threshold = options.threshold || INT_MIN

    var resultsLen = 0;

    if (options.weighedKey) {
        var scoreFn = options['scoreFn'] || defaultScoreFn
        for (var obj of targets) {
            var pairs = obj[options.weighedKey]
            var objResults = new Array(pairs.length)
            for (var keyI = 0; keyI < pairs.length; ++keyI) {
                var pair = pairs[keyI]
                var target = pair[0]
                if (!target) { objResults[keyI] = null; continue }
                if (!isObj(target)) target = getPrepared(target)

                if ((searchBitflags & target._bitflags) !== searchBitflags) objResults[keyI] = null
                else objResults[keyI] = algorithm(preparedSearch, target)
                if (objResults[keyI]) objResults[keyI].score /= pair[1];
            }
            objResults.obj = obj // before scoreFn so scoreFn can use it
            var score = scoreFn(objResults)
            if (score === null) continue
            if (score < threshold) continue
            objResults.score = score
            q.add(objResults);
            ++resultsLen
        }

    }

    if (resultsLen === 0) return noResults
    var results = new Array(resultsLen)
    for (var i = resultsLen - 1; i >= 0; --i) results[i] = q.poll()
    results.total = resultsLen
    return results
}


var prepare = (target) => {
    if (typeof target !== 'string') target = ''
    var info = prepareLowerInfo(target)
    return { target, _targetLower: info._lower, _targetLowerCodes: info.lowerCodes, _nextBeginningIndexes: null, _bitflags: info.bitflags, 'score': null, _indexes: [0], 'obj': null } // hidden
}


// Below this point is only internal code
// Below this point is only internal code
// Below this point is only internal code
// Below this point is only internal code


var prepareSearch = (search) => {
    if (typeof search !== 'string') search = ''
    search = search.trim()
    var info = prepareLowerInfo(search)

    var spaceSearches = []
    if (info.containsSpace) {
        var searches = search.split(/\s+/)
        searches = [...new Set(searches)] // distinct
        for (var i = 0; i < searches.length; i++) {
            if (searches[i] === '') continue
            var _info = prepareLowerInfo(searches[i])
            spaceSearches.push({ lowerCodes: _info.lowerCodes, _lower: searches[i].toLowerCase(), containsSpace: false })
        }
    }

    return { lowerCodes: info.lowerCodes, bitflags: info.bitflags, containsSpace: info.containsSpace, _lower: info._lower, spaceSearches: spaceSearches }
}



var getPrepared = (target) => {
    if (target.length > 999) return prepare(target) // don't cache huge targets
    var targetPrepared = preparedCache.get(target)
    if (targetPrepared !== undefined) return targetPrepared
    targetPrepared = prepare(target)
    preparedCache.set(target, targetPrepared)
    return targetPrepared
}
var getPreparedSearch = (search) => {
    if (search.length > 999) return prepareSearch(search) // don't cache huge searches
    var searchPrepared = preparedSearchCache.get(search)
    if (searchPrepared !== undefined) return searchPrepared
    searchPrepared = prepareSearch(search)
    preparedSearchCache.set(search, searchPrepared)
    return searchPrepared
}


var algorithm = (preparedSearch, prepared, allowSpaces = false) => {
    if (allowSpaces === false && preparedSearch.containsSpace) return algorithmSpaces(preparedSearch, prepared)

    var searchLower = preparedSearch._lower
    var searchLowerCodes = preparedSearch.lowerCodes
    var searchLowerCode = searchLowerCodes[0]
    var targetLowerCodes = prepared._targetLowerCodes
    var searchLen = searchLowerCodes.length
    var targetLen = targetLowerCodes.length
    var searchI = 0 // where we at
    var targetI = 0 // where you at
    var matchesSimpleLen = 0

    // very basic fuzzy match; to remove non-matching targets ASAP!
    // walk through target. find sequential matches.
    // if all chars aren't found then exit
    for (; ;) {
        var isMatch = searchLowerCode === targetLowerCodes[targetI]
        if (isMatch) {
            matchesSimple[matchesSimpleLen++] = targetI
            ++searchI; if (searchI === searchLen) break
            searchLowerCode = searchLowerCodes[searchI]
        }
        ++targetI; if (targetI >= targetLen) return null // Failed to find searchI
    }

    var searchI = 0
    var successStrict = false
    var matchesStrictLen = 0

    var nextBeginningIndexes = prepared._nextBeginningIndexes
    if (nextBeginningIndexes === null) nextBeginningIndexes = prepared._nextBeginningIndexes = prepareNextBeginningIndexes(prepared.target)
    var targetI = matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1]

    // Our target string successfully matched all characters in sequence!
    // Let's try a more advanced and strict test to improve the score
    // only count it as a match if it's consecutive or a beginning character!
    var backtrackCount = 0
    if (targetI !== targetLen) for (; ;) {
        if (targetI >= targetLen) {
            // We failed to find a good spot for this search char, go back to the previous search char and force it forward
            if (searchI <= 0) break // We failed to push chars forward for a better match

            ++backtrackCount; if (backtrackCount > 200) break // exponential backtracking is taking too long, just give up and return a bad match

            --searchI
            var lastMatch = matchesStrict[--matchesStrictLen]
            targetI = nextBeginningIndexes[lastMatch]

        } else {
            var isMatch = searchLowerCodes[searchI] === targetLowerCodes[targetI]
            if (isMatch) {
                matchesStrict[matchesStrictLen++] = targetI
                ++searchI; if (searchI === searchLen) { successStrict = true; break }
                ++targetI
            } else {
                targetI = nextBeginningIndexes[targetI]
            }
        }
    }

    // check if it's a substring match
    var substringIndex = prepared._targetLower.indexOf(searchLower, matchesSimple[0]) // perf: this is slow
    var isSubstring = ~substringIndex
    if (isSubstring && !successStrict) { // rewrite the indexes from basic to the substring
        for (var i = 0; i < matchesSimpleLen; ++i) matchesSimple[i] = substringIndex + i
    }
    var isSubstringBeginning = false
    if (isSubstring) {
        isSubstringBeginning = prepared._nextBeginningIndexes[substringIndex - 1] === substringIndex
    }

    { // tally up the score & keep track of matches for highlighting later
        if (successStrict) { var matchesBest = matchesStrict; var matchesBestLen = matchesStrictLen }
        else { var matchesBest = matchesSimple; var matchesBestLen = matchesSimpleLen }

        var score = 0

        var extraMatchGroupCount = 0
        for (var i = 1; i < searchLen; ++i) {
            if (matchesBest[i] - matchesBest[i - 1] !== 1) { score -= matchesBest[i]; ++extraMatchGroupCount }
        }
        var unmatchedDistance = matchesBest[searchLen - 1] - matchesBest[0] - (searchLen - 1)

        score -= (12 + unmatchedDistance) * extraMatchGroupCount // penality for more groups

        if (matchesBest[0] !== 0) score -= matchesBest[0] * matchesBest[0] * .2 // penality for not starting near the beginning

        if (!successStrict) {
            score *= 1000
        } else {
            // successStrict on a target with too many beginning indexes loses points for being a bad target
            var uniqueBeginningIndexes = 1
            for (var i = nextBeginningIndexes[0]; i < targetLen; i = nextBeginningIndexes[i]) ++uniqueBeginningIndexes

            if (uniqueBeginningIndexes > 24) score *= (uniqueBeginningIndexes - 24) * 10 // quite arbitrary numbers here ...
        }

        if (isSubstring) score /= 1 + searchLen * searchLen * 1 // bonus for being a full substring
        if (isSubstringBeginning) score /= 1 + searchLen * searchLen * 1 // bonus for substring starting on a beginningIndex

        score -= targetLen - searchLen // penality for longer targets
        prepared.score = score

        for (var i = 0; i < matchesBestLen; ++i) prepared._indexes[i] = matchesBest[i]
        prepared._indexes.len = matchesBestLen

        return prepared
    }
}
var algorithmSpaces = (preparedSearch, target) => {
    var seen_indexes = new Set()
    var score = 0
    var result = null

    var first_seen_index_last_search = 0
    var searches = preparedSearch.spaceSearches
    for (var i = 0; i < searches.length; ++i) {
        var search = searches[i]

        result = algorithm(search, target)
        if (result === null) return null

        score += result.score

        // dock points based on order otherwise "c man" returns Manifest.cpp instead of CheatManager.h
        if (result._indexes[0] < first_seen_index_last_search) {
            score -= first_seen_index_last_search - result._indexes[0]
        }
        first_seen_index_last_search = result._indexes[0]

        for (var j = 0; j < result._indexes.len; ++j) seen_indexes.add(result._indexes[j])
    }

    // allows a search with spaces that's an exact substring to score well
    var allowSpacesResult = algorithm(preparedSearch, target, /*allowSpaces=*/true)
    if (allowSpacesResult !== null && allowSpacesResult.score > score) {
        return allowSpacesResult
    }

    result.score = score

    var i = 0
    for (let index of seen_indexes) result._indexes[i++] = index
    result._indexes.len = i

    return result
}


var prepareLowerInfo = (str) => {
    var strLen = str.length
    var lower = str.toLowerCase()
    var lowerCodes = [] // new Array(strLen)    sparse array is too slow
    var bitflags = 0
    var containsSpace = false // space isn't stored in bitflags because of how searching with a space works

    for (var i = 0; i < strLen; ++i) {
        var lowerCode = lowerCodes[i] = lower.charCodeAt(i)

        if (lowerCode === 32) {
            containsSpace = true
            continue // it's important that we don't set any bitflags for space
        }

        var bit = lowerCode >= 97 && lowerCode <= 122 ? lowerCode - 97 // alphabet
            : lowerCode >= 48 && lowerCode <= 57 ? 26           // numbers
                // 3 bits available
                : lowerCode <= 127 ? 30           // other ascii
                    : 31           // other utf8
        bitflags |= 1 << bit
    }

    return { lowerCodes: lowerCodes, bitflags: bitflags, containsSpace: containsSpace, _lower: lower }
}
var prepareBeginningIndexes = (target) => {
    var targetLen = target.length
    var beginningIndexes = []; var beginningIndexesLen = 0
    var wasUpper = false
    var wasAlphanum = false
    for (var i = 0; i < targetLen; ++i) {
        var targetCode = target.charCodeAt(i)
        var isUpper = targetCode >= 65 && targetCode <= 90
        var isAlphanum = isUpper || targetCode >= 97 && targetCode <= 122 || targetCode >= 48 && targetCode <= 57
        var isBeginning = isUpper && !wasUpper || !wasAlphanum || !isAlphanum
        wasUpper = isUpper
        wasAlphanum = isAlphanum
        if (isBeginning) beginningIndexes[beginningIndexesLen++] = i
    }
    return beginningIndexes
}
var prepareNextBeginningIndexes = (target) => {
    var targetLen = target.length
    var beginningIndexes = prepareBeginningIndexes(target)
    var nextBeginningIndexes = [] // new Array(targetLen)     sparse array is too slow
    var lastIsBeginning = beginningIndexes[0]
    var lastIsBeginningI = 0
    for (var i = 0; i < targetLen; ++i) {
        if (lastIsBeginning > i) {
            nextBeginningIndexes[i] = lastIsBeginning
        } else {
            lastIsBeginning = beginningIndexes[++lastIsBeginningI]
            nextBeginningIndexes[i] = lastIsBeginning === undefined ? targetLen : lastIsBeginning
        }
    }
    return nextBeginningIndexes
}


var cleanup = () => { preparedCache.clear(); preparedSearchCache.clear(); matchesSimple = []; matchesStrict = [] }

var preparedCache = new Map()
var preparedSearchCache = new Map()
var matchesSimple = []; var matchesStrict = []


// for use with keys. just returns the maximum score
var defaultScoreFn = (a) => {
    var max = INT_MIN
    var len = a.length
    for (var i = 0; i < len; ++i) {
        var result = a[i]; if (result === null) continue
        var score = result.score
        if (score > max) max = score
    }
    if (max === INT_MIN) return null
    return max
}

var isObj = (x) => { return typeof x === 'object' } // faster as a function
// var INT_MAX = 9007199254740991; var INT_MIN = -INT_MAX
var INT_MAX = Infinity; var INT_MIN = -INT_MAX
var noResults = []; noResults.total = 0


// Hacked version of https://github.com/lemire/FastPriorityQueue.js
var fastpriorityqueue = r => { var e = [], o = 0, a = {}, v = r => { for (var a = 0, v = e[a], c = 1; c < o;) { var s = c + 1; a = c, s < o && e[s].score < e[c].score && (a = s), e[a - 1 >> 1] = e[a], c = 1 + (a << 1) } for (var f = a - 1 >> 1; a > 0 && v.score < e[f].score; f = (a = f) - 1 >> 1)e[a] = e[f]; e[a] = v }; return a.add = (r => { var a = o; e[o++] = r; for (var v = a - 1 >> 1; a > 0 && r.score < e[v].score; v = (a = v) - 1 >> 1)e[a] = e[v]; e[a] = r }), a.poll = (r => { if (0 !== o) { var a = e[0]; return e[0] = e[--o], v(), a } }), a.peek = (r => { if (0 !== o) return e[0] }), a.replaceTop = (r => { e[0] = r, v() }), a }
var q = fastpriorityqueue() // reuse this


// fuzzysort is written this way for minification. all names are mangeled unless quoted
module.exports = { 'go': go, 'prepare': prepare, 'cleanup': cleanup }

// TODO: (feature) frecency
// TODO: (perf) use different sorting algo depending on the # of results?
// TODO: (perf) preparedCache is a memory leak
// TODO: (like sublime) backslash === forwardslash
// TODO: (perf) prepareSearch seems slow
