port module Main exposing (Model, Msg(..), init, main, update)

import AirQuality as AQ exposing (Coordinate, Estimate, Metric(..), Reading, Snapshot)
import Browser
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (on, onClick, onInput)
import Json.Decode as D
import Json.Encode as E
import Set exposing (Set)


port effects : E.Value -> Cmd msg


port events : (D.Value -> msg) -> Sub msg


type alias Model =
    { snapshot : Maybe Snapshot
    , loading : Bool
    , region : String
    , location : Maybe Located
    , requesting : Bool
    , error : String
    , requestId : Int
    , disclosures : Set String
    , theme : String
    }


type alias Located =
    { estimate : Estimate, coordinate : Coordinate, fingerprint : String, capturedAt : Float, name : Maybe String }


type Msg
    = Received D.Value
    | SelectRegion String
    | RequestLocation
    | Retry
    | Toggle String Bool
    | CycleTheme


main : Program String Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = \_ -> events Received
        , view = view
        }


init : String -> ( Model, Cmd Msg )
init theme =
    ( { snapshot = Nothing, loading = True, region = "central", location = Nothing, requesting = False, error = "", requestId = 0, disclosures = Set.empty, theme = theme }, effect "load" [] )


effect : String -> List ( String, E.Value ) -> Cmd Msg
effect kind fields =
    effects (E.object (( "kind", E.string kind ) :: fields))


preference : Bool -> Cmd Msg
preference enabled =
    effect "preference" [ ( "enabled", E.bool enabled ) ]


sync : Bool -> Model -> Cmd Msg
sync replace model =
    effect "sync"
        [ ( "replace", E.bool replace )
        , ( "region", E.string model.region )
        , ( "location"
          , case model.location of
                Nothing ->
                    E.null

                Just located ->
                    E.object
                        [ ( "coordinate", coordinateValue located.coordinate )
                        , ( "capturedAt", E.float located.capturedAt )
                        , ( "fingerprint", E.string located.fingerprint )
                        , ( "weights", E.object (List.map (\c -> ( c.region, E.float c.weight )) located.estimate.contributions) )
                        ]
          )
        ]


coordinateValue : Coordinate -> E.Value
coordinateValue c =
    E.object [ ( "latitude", E.float c.latitude ), ( "longitude", E.float c.longitude ) ]


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SelectRegion region ->
            if List.member region AQ.regions then
                let
                    next =
                        { model | region = region, location = Nothing, requesting = False, error = "", requestId = model.requestId + 1 }
                in
                ( next, Cmd.batch [ preference False, sync True next ] )

            else
                ( model, Cmd.none )

        RequestLocation ->
            let
                next =
                    { model | requesting = True, error = "", requestId = model.requestId + 1 }
            in
            ( next, effect "location" [ ( "id", E.int next.requestId ) ] )

        Retry ->
            ( { model | loading = True }, effect "load" [] )

        Toggle key opened ->
            ( { model
                | disclosures =
                    (if opened then
                        Set.insert

                     else
                        Set.remove
                    )
                        key
                        model.disclosures
              }
            , Cmd.none
            )

        CycleTheme ->
            let
                theme =
                    nextTheme model.theme
            in
            ( { model | theme = theme }, effect "theme" [ ( "theme", E.string theme ) ] )

        Received value ->
            case D.decodeValue (D.field "kind" D.string) value of
                Ok "snapshot" ->
                    case D.decodeValue (D.field "snapshot" AQ.decoder) value of
                        Ok snapshot ->
                            let
                                next =
                                    refreshLocation { model | snapshot = Just snapshot, loading = False } snapshot
                            in
                            ( next
                            , Cmd.batch
                                [ sync False next
                                , if model.requestId == 0 then
                                    effect "restoreLocation" []

                                  else
                                    Cmd.none
                                ]
                            )

                        Err _ ->
                            ( { model | loading = False, snapshot = Just { pm25 = Unavailable "The data source returned an unexpected response.", psi = Unavailable "The data source returned an unexpected response." } }, Cmd.none )

                Ok "position" ->
                    let
                        decoded =
                            D.decodeValue
                                (D.map3 (\requestId coordinate capturedAt -> ( requestId, coordinate, capturedAt ))
                                    (D.field "id" D.int)
                                    (D.field "coordinate" (D.map2 Coordinate (D.field "latitude" D.float) (D.field "longitude" D.float)))
                                    (D.field "capturedAt" D.float)
                                )
                                value
                    in
                    case decoded of
                        Ok ( requestId, coordinate, capturedAt ) ->
                            if requestId /= model.requestId then
                                ( model, Cmd.none )

                            else
                                applyPosition coordinate capturedAt model

                        Err _ ->
                            ( { model | requesting = False, error = "The browser returned an invalid location." }, Cmd.none )

                Ok "locationError" ->
                    let
                        requestId =
                            fieldInt "id" value

                        denied =
                            D.decodeValue (D.field "denied" D.bool) value == Ok True

                        next =
                            { model
                                | requesting = False
                                , error = fieldString "message" value
                                , location =
                                    if denied then
                                        Nothing

                                    else
                                        model.location
                            }
                    in
                    if requestId /= model.requestId then
                        ( model, Cmd.none )

                    else
                        ( next
                        , if denied then
                            Cmd.batch [ preference False, sync True next ]

                          else
                            Cmd.none
                        )

                Ok "locationName" ->
                    case model.location of
                        Just located ->
                            if fieldInt "id" value == model.requestId then
                                ( { model | location = Just { located | name = D.decodeValue (D.field "name" (D.nullable D.string)) value |> Result.withDefault Nothing } }, Cmd.none )

                            else
                                ( model, Cmd.none )

                        Nothing ->
                            ( model, Cmd.none )

                Ok "restoreLocation" ->
                    if model.requestId == 0 && hasPm25 model then
                        update RequestLocation model

                    else
                        ( model, Cmd.none )

                Ok "savedRegion" ->
                    if model.requestId == 0 then
                        let
                            next =
                                { model | region = fieldString "region" value }
                        in
                        ( next, sync False next )

                    else
                        ( model, Cmd.none )

                Ok "theme" ->
                    ( { model | theme = fieldString "theme" value }, Cmd.none )

                _ ->
                    ( model, Cmd.none )


fieldString : String -> D.Value -> String
fieldString key value =
    D.decodeValue (D.field key D.string) value |> Result.withDefault ""


fieldInt : String -> D.Value -> Int
fieldInt key value =
    D.decodeValue (D.field key D.int) value |> Result.withDefault -1


refreshLocation : Model -> Snapshot -> Model
refreshLocation model snapshot =
    case ( model.location, snapshot.pm25 ) of
        ( Just located, Available reading ) ->
            if located.fingerprint /= reading.fingerprint then
                { model | location = Nothing, error = "Regional reference points changed. Use your location again to rebuild the estimate." }

            else
                let
                    contributions =
                        List.map (\c -> { c | value = AQ.regionalValue c.region reading }) located.estimate.contributions

                    estimate =
                        located.estimate
                in
                { model | location = Just { located | estimate = { estimate | contributions = contributions, value = AQ.weightedValue contributions } } }

        _ ->
            model


applyPosition : Coordinate -> Float -> Model -> ( Model, Cmd Msg )
applyPosition coordinate capturedAt model =
    case Maybe.map .pm25 model.snapshot of
        Just (Available reading) ->
            case AQ.estimate coordinate reading of
                Ok estimate ->
                    let
                        next =
                            { model | region = estimate.closestRegion, requesting = False, location = Just { coordinate = coordinate, estimate = estimate, capturedAt = capturedAt, fingerprint = reading.fingerprint, name = Nothing } }
                    in
                    ( next, Cmd.batch [ preference True, sync True next, effect "lookup" [ ( "id", E.int model.requestId ), ( "coordinate", coordinateValue coordinate ) ] ] )

                Err message ->
                    ( { model | requesting = False, error = message }, Cmd.none )

        _ ->
            ( { model | requesting = False, error = "PM2.5 data is unavailable, so no estimate can be made." }, Cmd.none )


hasPm25 : Model -> Bool
hasPm25 model =
    case Maybe.map .pm25 model.snapshot of
        Just (Available _) ->
            True

        _ ->
            False


nextTheme : String -> String
nextTheme theme =
    case theme of
        "system" ->
            "light"

        "light" ->
            "dark"

        _ ->
            "system"


label : String -> String
label value =
    String.toUpper (String.left 1 value) ++ String.dropLeft 1 value


paragraph : String -> String -> Html msg
paragraph css copy =
    p [ class css ] [ text copy ]


external : String -> String -> Html msg
external url copy =
    a [ href url, target "_blank", rel "noreferrer" ] [ text copy ]


view : Model -> Html Msg
view model =
    div [ class "page-shell" ]
        [ header [ class "masthead" ]
            [ a [ class "brand", href "./", attribute "aria-label" "Airq home" ]
                [ span [ class "brand-mark", attribute "aria-hidden" "true" ] [ i [] [], i [] [], i [] [] ], span [] [ text "Airq" ] ]
            , div [ class "masthead-actions" ]
                [ button [ id "theme-button", class "theme-button", type_ "button", onClick CycleTheme, attribute "aria-label" ("Appearance: " ++ label model.theme ++ ". Switch to " ++ label (nextTheme model.theme)) ] [ text ("Theme: " ++ label model.theme) ]
                , a [ class "source-link", href "https://www.haze.gov.sg/", target "_blank", rel "noreferrer" ] [ text "haze.gov.sg ", span [ attribute "aria-hidden" "true" ] [ text "↗" ] ]
                ]
            ]
        , section [ class "hero", attribute "aria-labelledby" "page-title" ]
            [ paragraph "eyebrow" "Singapore air quality", h1 [ id "page-title" ] [ text "Air quality now." ], paragraph "hero-copy" "1-hour PM2.5 and 24-hour PSI, by region or your location." ]
        , controls model
        , section [ class "readings", attribute "aria-live" "polite", attribute "aria-busy" (boolString model.loading) ] (readings model)
        , if hasPm25 model && not model.loading then
            node "airq-map" [] []

          else
            text ""
        , node "airq-badge" [] []
        , disclosure model
            "reading-guidance"
            "method-note"
            "About these readings and estimates"
            [ div []
                [ h2 [] [ text "Regional data, carefully labeled." ]
                , p [] [ text "NEA reports five broad regions. A location estimate blends their PM2.5 readings by distance. It is an approximation and cannot account for wind, nearby sources, or street-level conditions." ]
                , p [] [ text "In location mode, PSI is an experimental blend of regional indices using the same distance weights. PSI is the highest pollutant sub-index, and different pollutants can drive different regions. Averaging those indices does not reconstruct an official local PSI. Do not use this blend as a health advisory; choose an official region or refer to NEA guidance." ]
                , p [] [ text "Estimate algorithm: ", external methodUrl "Inverse-distance weighting with power 2, explained by Esri ↗", text "." ]
                , external "https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs" "Read NEA guidance ↗"
                ]
            ]
        , footer [ class "site-footer" ]
            [ p [] [ text "Data from the National Environment Agency via data.gov.sg." ]
            , p [] [ text "For immediate activity decisions, refer to the 1-hour PM2.5 reading and official guidance." ]
            , p [] [ external "https://github.com/chrisirhc/airq" "Source code on GitHub" ]
            ]
        ]


boolString : Bool -> String
boolString value =
    if value then
        "true"

    else
        "false"


controls : Model -> Html Msg
controls model =
    let
        located =
            model.location /= Nothing

        buttonText =
            if model.loading then
                "Loading readings…"

            else if model.requesting then
                "Finding your location…"

            else if located then
                "Using your location"

            else
                "Use my location"

        message =
            if model.requesting then
                [ p [ class "control-message", attribute "role" "status" ] [ text "Finding your location to calculate a PM2.5 estimate." ] ]

            else if model.error /= "" then
                [ p [ class "control-message error", attribute "role" "alert" ] [ text model.error ] ]

            else
                case model.location of
                    Nothing ->
                        []

                    Just location ->
                        [ p [ class "control-message" ]
                            (case location.name of
                                Nothing ->
                                    [ text "Your location" ]

                                Just name ->
                                    [ text ("Your location: near " ++ name ++ ". "), external "https://www.onemap.gov.sg/" "OneMap, Singapore Land Authority" ]
                            )
                        , p [ class "control-message success", attribute "role" "status" ] [ text "Location found. Showing an approximate PM2.5 estimate." ]
                        ]
    in
    section [ class "controls", attribute "aria-label" "Location and region controls" ]
        ([ button
            [ class
                ("location-button"
                    ++ (if located then
                            " is-active"

                        else
                            ""
                       )
                )
            , id "location-button"
            , type_ "button"
            , onClick RequestLocation
            , disabled (model.requesting || model.loading)
            , attribute "aria-pressed" (boolString located)
            , attribute "aria-busy" (boolString model.requesting)
            ]
            [ span [ class "location-icon", attribute "aria-hidden" "true" ]
                [ text
                    (if located && not model.requesting then
                        "✓"

                     else
                        "⌖"
                    )
                ]
            , text buttonText
            ]
         , div [ class "divider", attribute "aria-hidden" "true" ] [ span [] [ text "or" ] ]
         , Html.label [ class "region-field" ]
            [ span [] [ text "Choose an official region" ]
            , select [ id "region-select", value model.region, onInput SelectRegion ] (List.map (\region -> option [ value region, selected (model.region == region) ] [ text (label region) ]) AQ.regions)
            ]
         , paragraph "privacy-note" "To name your location, coordinates are sent through our server to OneMap. AirQ does not save them."
         ]
            ++ message
        )


readings : Model -> List (Html Msg)
readings model =
    if model.loading then
        List.map (\copy -> article [ class "reading-card skeleton-card" ] [ paragraph "card-kicker" copy, div [ class "skeleton-line wide" ] [], div [ class "skeleton-line" ] [] ]) [ "Loading official data", "Checking latest readings" ]

    else
        case model.snapshot of
            Nothing ->
                []

            Just snapshot ->
                [ readingCard model False snapshot.pm25, readingCard model True snapshot.psi ]


readingCard : Model -> Bool -> Metric -> Html Msg
readingCard model isPsi metric =
    case metric of
        Unavailable message ->
            article [ class "reading-card unavailable-card" ]
                [ paragraph "card-kicker"
                    (if isPsi then
                        "24-hour PSI"

                     else
                        "1-hour PM2.5"
                    )
                , h2 [] [ text "Reading unavailable" ]
                , p [] [ text message ]
                , button [ type_ "button", class "text-button retry-button", onClick Retry ] [ text "Try again" ]
                ]

        Available reading ->
            let
                estimated =
                    model.location /= Nothing

                contributions =
                    model.location |> Maybe.map (\l -> List.map (\c -> { c | value = AQ.regionalValue c.region reading }) l.estimate.contributions) |> Maybe.withDefault []

                value_ =
                    if estimated then
                        AQ.weightedValue contributions

                    else
                        AQ.regionalValue model.region reading

                ( level, descriptor ) =
                    if isPsi then
                        AQ.psiBand value_

                    else
                        AQ.pm25Band value_

                metricName =
                    if isPsi then
                        "PSI"

                    else
                        "PM2.5"

                title =
                    if estimated then
                        if isPsi then
                            "Estimated PSI (experimental)"

                        else
                            "Estimated PM2.5"

                    else
                        label model.region ++ " region " ++ metricName

                status =
                    if isPsi then
                        (if estimated then
                            "Approximate · "

                         else
                            ""
                        )
                            ++ descriptor

                    else
                        "Band " ++ String.fromInt level ++ " · " ++ descriptor

                detail =
                    if isPsi then
                        if estimated then
                            "Experimental regional blend · not an official local PSI or health advisory"

                        else
                            "Official regional reading"

                    else if estimated then
                        "Approximate 1-hour concentration · not a local measurement"

                    else
                        "Official 1-hour regional concentration"

                badge =
                    if reading.source == "cached" then
                        "Cached"

                    else if reading.stale then
                        "Stale"

                    else
                        "Live data"
            in
            article
                [ class
                    ("reading-card "
                        ++ (if isPsi then
                                "psi-tone-"

                            else
                                "primary-card pm25-tone-"
                           )
                        ++ String.fromInt level
                    )
                ]
                [ div [ class "card-heading" ]
                    [ div [] [ paragraph "card-kicker" title, p [ class "status-label" ] [ span [ class "severity-marker", attribute "aria-hidden" "true" ] [], text status ] ]
                    , span
                        [ class
                            ("data-badge"
                                ++ (if badge == "Live data" then
                                        ""

                                    else
                                        " warning"
                                   )
                            )
                        ]
                        [ text badge ]
                    ]
                , div [ class "reading-value" ]
                    [ strong [] [ text (String.fromInt (round value_)) ]
                    , span []
                        [ text
                            (if isPsi then
                                "24-hour PSI"

                             else
                                "µg/m³"
                            )
                        ]
                    ]
                , paragraph "card-detail" detail
                , if estimated then
                    calculation model isPsi contributions value_

                  else
                    text ""
                , paragraph "timestamp" ("Reading at " ++ reading.timestamp)
                ]


methodUrl : String
methodUrl =
    "https://pro.arcgis.com/en/pro-app/3.5/help/analysis/geostatistical-analyst/how-inverse-distance-weighted-interpolation-works.htm"


disclosure : Model -> String -> String -> String -> List (Html Msg) -> Html Msg
disclosure model key css title children =
    details [ id key, class css, property "open" (E.bool (Set.member key model.disclosures)), on "toggle" (D.map (Toggle key) (D.at [ "target", "open" ] D.bool)) ] (summary [] [ text title ] :: children)


fixed : Float -> String
fixed number =
    let
        hundredths =
            round (number * 100)

        decimals =
            String.fromInt (modBy 100 hundredths) |> String.padLeft 2 '0'
    in
    String.fromInt (hundredths // 100) ++ "." ++ decimals


calculation : Model -> Bool -> List AQ.Contribution -> Float -> Html Msg
calculation model isPsi contributions value_ =
    let
        sorted =
            List.sortBy (\c -> -c.weight) contributions

        unit =
            if isPsi then
                ""

            else
                " µg/m³"

        method =
            case List.filter (\c -> c.distanceMeters <= 1) contributions |> List.head of
                Just exact ->
                    "Your location is within 1 metre of the " ++ label exact.region ++ " reference point, so its reading receives 100% weight and the other regions receive 0%."

                Nothing ->
                    "Distances are measured from your location to the five regional reference points supplied with the PM2.5 data. Each weight is (1 ÷ distance²) divided by the sum of all five (1 ÷ distance²) values. Closer regions receive more weight."

        terms =
            List.map (\c -> String.fromFloat c.value ++ " × " ++ fixed (c.weight * 100) ++ "%") sorted |> String.join " + "
    in
    disclosure model
        (if isPsi then
            "psi-estimate-calculation"

         else
            "estimate-calculation"
        )
        "contributions"
        "How your estimate is calculated"
        [ section
            [ attribute "aria-label"
                (if isPsi then
                    "Experimental PSI calculation"

                 else
                    "Estimate calculation"
                )
            ]
            [ if isPsi then
                p [] [ text "This is a weighted blend of the final regional PSI indices, not of pollutant concentrations. Different pollutants may drive each region’s index; the blend is not a scientifically validated local PSI or a health advisory. Select a region for its official PSI." ]

              else
                text ""
            , p [] [ text method ]
            , div [ class "contribution-table" ]
                [ table []
                    [ caption []
                        [ text
                            ("Official "
                                ++ (if isPsi then
                                        "24-hour PSI"

                                    else
                                        "1-hour PM2.5"
                                   )
                                ++ " readings used in this "
                                ++ (if isPsi then
                                        "experimental blend"

                                    else
                                        "estimate"
                                   )
                            )
                        ]
                    , thead []
                        [ tr []
                            (List.map (\copy -> th [ scope "col" ] [ text copy ])
                                [ "Region"
                                , if isPsi then
                                    "24-hour PSI"

                                  else
                                    "PM2.5 µg/m³"
                                , "Distance km"
                                , "Weight"
                                ]
                            )
                        ]
                    , tbody [] (List.map (\c -> tr [] [ th [ scope "row" ] [ text (label c.region) ], td [] [ text (String.fromFloat c.value) ], td [] [ text (fixed (c.distanceMeters / 1000)) ], td [] [ text (fixed (c.weight * 100) ++ "%") ] ]) sorted)
                    ]
                ]
            , paragraph "estimate-equation" (terms ++ " ≈ " ++ fixed value_ ++ unit)
            , p [] [ text ("Multiply each regional reading by its weight, then add the results. The headline rounds this to " ++ String.fromInt (round value_) ++ unit ++ ". Distances and weights above are rounded for display; the calculation uses their full precision.") ]
            , p []
                [ external methodUrl "Read Esri's explanation of inverse-distance weighting ↗"
                , text
                    (". This "
                        ++ (if isPsi then
                                "experimental blend"

                            else
                                "estimate"
                           )
                        ++ " uses power 2 with all five regional reference points."
                        ++ (if isPsi then
                                " This reference explains the weighting method, not the validity of blending PSI indices."

                            else
                                ""
                           )
                    )
                ]
            ]
        ]
