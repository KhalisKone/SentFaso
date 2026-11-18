; Raccourcis avec l'icône de la mascotte (l'exécutable n'est pas retouché : construction sans wine).
!macro customInstall
  CreateShortCut "$DESKTOP\Dites-le-nous une fois.lnk" "$INSTDIR\Dites-le-nous une fois.exe" "" "$INSTDIR\resources\icone.ico" 0
  CreateShortCut "$SMPROGRAMS\Dites-le-nous une fois.lnk" "$INSTDIR\Dites-le-nous une fois.exe" "" "$INSTDIR\resources\icone.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Dites-le-nous une fois.lnk"
  Delete "$SMPROGRAMS\Dites-le-nous une fois.lnk"
!macroend
